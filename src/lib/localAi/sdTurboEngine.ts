// src/lib/localAi/sdTurboEngine.ts
import { supabase } from "@/integrations/supabase/client";

type OrtMod = typeof import("onnxruntime-web");
type OrtSess = Awaited<ReturnType<OrtMod["InferenceSession"]["create"]>>;
type OrtTens = InstanceType<OrtMod["Tensor"]>;

// sdTurboEngine.ts - Git LFS 경로 사용!
const HF = "https://huggingface.co/schmuell/sd-turbo-ort-web/";
// sdTurboEngine.ts - URLS 완전 교체!
const URLS = {
  te: "https://huggingface.co/onnxruntime/sd-turbo/resolve/main/text_encoder/model.onnx",
  un: "https://huggingface.co/onnxruntime/sd-turbo/resolve/main/unet/model.onnx",
  vae: "https://huggingface.co/onnxruntime/sd-turbo/resolve/main/vae_decoder/model.onnx",
};

async function makeSession(
  url: string,
  o: OrtMod,
  onS?: (s: string) => void
): Promise<OrtSess> {
  const buf = await downloadModel(url, onS);
  const opt = { graphOptimizationLevel: "all" as const };

  try {
    onS?.("WebGPU 세션 생성 중...");
    return await o.InferenceSession.create(new Uint8Array(buf), {
      ...opt,
      executionProviders: ["webgpu"],
    });
  } catch (e) {
    console.warn("[SD] WebGPU 실패 → WASM 폴백:", e);
    onS?.("WebGPU 불가 → CPU(WASM) 전환 중...");
    return await o.InferenceSession.create(new Uint8Array(buf), {
      ...opt,
      executionProviders: ["wasm"],
    });
  }
}

// ── DDPM 스케줄러 (alpha_cumprod) ────────────────────────────────────────────
function buildAlphas(n = 1000): Float32Array {
  const a = new Float32Array(n);
  const bs = 0.00085 ** 0.5;
  const be = 0.012 ** 0.5;
  let cp = 1;
  for (let i = 0; i < n; i++) {
    const t    = i / (n - 1);
    const beta = (bs + t * (be - bs)) ** 2;
    cp       *= 1 - beta;
    a[i]      = cp;
  }
  return a;
}
const ALPHA_CP = buildAlphas();

// ── 싱글톤 ──────────────────────────────────────────────────────────────────
let _ort: OrtMod  | null = null;
let _te:  OrtSess | null = null;
let _un:  OrtSess | null = null;
let _vae: OrtSess | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tok: any = null;

// ── 헬퍼 ────────────────────────────────────────────────────────────────────
async function getOrt(): Promise<OrtMod> {
  if (!_ort) {
    _ort = await import("onnxruntime-web");
    // WASM 바이너리 CDN 경로 (onnxruntime-web 번들이 못 찾을 때 대비)
    _ort.env.wasm.wasmPaths =
      "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
  }
  return _ort;
}

async function downloadModel(url: string, onS?: (s: string) => void): Promise<ArrayBuffer> {
  // 1. HF 토큰 가져오기
  const { data } = await supabase
    .from("user_api_keys")
    .select("api_key")
    .eq("provider", "huggingface")
    .single();

  const token = data?.api_key;
  if (!token) {
    throw new Error(
      "❌ HuggingFace 토큰이 없습니다.\n" +
      "Settings 페이지에서 HuggingFace Access Token을 등록해주세요."
    );
  }

  onS?.(`다운로드: ${url.split("/").pop()}`);

  // 2. URL에서 파일명 추출
  const path = url.replace(/.*\/resolve\/main\//, '');

  // 3. HuggingFace API로 파일 정보 요청
  const apiUrl = `https://huggingface.co/api/models/schmuell/sd-turbo-ort-web/${path}`;
  const response = await fetch(apiUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${apiUrl}`);
  }

  // 4. 파일 데이터를 ArrayBuffer로 변환
  const arrayBuffer = await response.arrayBuffer();

  // 5. 진행 상황 표시 (파일 크기)
  const total = arrayBuffer.byteLength;
  if (total > 0) {
    const pct = 100;
    onS?.(`${pct}%  (${(total / 1e6).toFixed(0)} MB)`);
  }

  return arrayBuffer;
}

async function ensureModels(onS?: (s: string) => void) {
  const o = await getOrt();
  if (!_te)  { onS?.("[1/3] 텍스트 인코더 로딩..."); _te  = await makeSession(URLS.te,  o, onS); }
  if (!_un)  { onS?.("[2/3] UNet 로딩 (~1.7 GB)..."); _un  = await makeSession(URLS.un,  o, onS); }
  if (!_vae) { onS?.("[3/3] VAE 디코더 로딩...");     _vae = await makeSession(URLS.vae, o, onS); }
}

// Box-Muller 가우시안 노이즈
function gaussianNoise(n: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(Math.random(), 1e-10);
    const u2 = Math.random();
    const m  = Math.sqrt(-2 * Math.log(u1));
    a[i]     = m * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) a[i + 1] = m * Math.sin(2 * Math.PI * u2);
  }
  return a;
}

// ── 메인 생성 함수 ───────────────────────────────────────────────────────────
export async function generateWithSDTurbo(
  prompt: string,
  onS?: (s: string) => void
): Promise<string> {
  const o = await getOrt();
  await ensureModels(onS);

  // 1. 토크나이즈 (CLIP ViT-L/14 tokenizer — SD 1.x 계열 표준)
  onS?.("텍스트 토크나이즈 중...");
  if (!_tok) {
    const { CLIPTokenizer } = await import("@huggingface/transformers");
    _tok = await CLIPTokenizer.from_pretrained("openai/clip-vit-large-patch14");
  }
  // v3 transformers.js: tokenizer() 는 from_pretrained 이후 동기 호출
  const enc = _tok(prompt, {
    padding: "max_length",
    max_length: 77,
    truncation: true,
  });
  const ids = Array.from(
    enc.input_ids.data as Int32Array | BigInt64Array
  ).map(Number);

  // 2. 텍스트 인코딩
  onS?.("텍스트 인코딩 중...");
  console.log("[TE] inputs:", _te!.inputNames, "outputs:", _te!.outputNames);

  // 텍스트 인코더 입력 (int32)
  const inputIdsTensor: OrtTens = new o.Tensor(
    "int32",
    new Int32Array(ids),
    [1, 77]
  );
  const teOut   = await _te!.run({ [_te!.inputNames[0]]: inputIdsTensor });
  const textEmb = teOut[_te!.outputNames[0]]; // [1, 77, 768]

  // 3. 노이즈 샘플링 + UNet (SD-Turbo 1-step, t=999)
  onS?.("UNet 추론 중... (WASM이면 수분 소요 가능)");
  console.log("[UN] inputs:", _un!.inputNames, "outputs:", _un!.outputNames);

  const T    = 999;
  const a    = ALPHA_CP[T];            // alpha_cumprod[999]
  const sqA  = Math.sqrt(a);           // sqrt(alpha)
  const sqoA = Math.sqrt(1 - a);       // sqrt(1-alpha)
  const sigma = sqoA / sqA;            // ≈ 26.99 (스케일 팩터)

  const L     = 4 * 64 * 64;
  const noise = gaussianNoise(L);
  const latent = noise.map(n => n * sigma);

  // 입력 텐서명 자동 탐지 (모델마다 다를 수 있음)
  const sName = _un!.inputNames.find(n => n === "sample")
             ?? _un!.inputNames[0];
  const tName = _un!.inputNames.find(n => n.includes("timestep"))
             ?? _un!.inputNames[1];
  const eName = _un!.inputNames.find(n => n.includes("encoder_hidden"))
             ?? _un!.inputNames[2];

  const unetInput: Record<string, OrtTens> = {
    // timestep: float32 (일부 모델은 int64 필요 —
    //   그럴 때: new o.Tensor("int64", new BigInt64Array([BigInt(T)]), [1]))
    [sName]: new o.Tensor("float32", new Float32Array(latent), [1, 4, 64, 64]),
    [tName]: new o.Tensor("float32", new Float32Array([T]),    [1]),
    [eName]: textEmb,
  };

  const unOut  = await _un!.run(unetInput);
  const pKey   = _un!.outputNames.find(n => n.includes("sample"))
              ?? _un!.outputNames[0];
  const pred   = unOut[pKey].data as Float32Array;

  // DDIM 1-step: x0 = (latent - sqrt(1-a)*pred) / sqrt(a)
  const x0 = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    x0[i] = (latent[i] - sqoA * pred[i]) / sqA;
  }

  // 4. VAE 디코드
  onS?.("VAE 디코딩 중...");
  console.log("[VAE] inputs:", _vae!.inputNames, "outputs:", _vae!.outputNames);

  const VAE_SCALE = 0.18215;
  const vaeIn    = x0.map(v => v / VAE_SCALE);
  const lvName   = _vae!.inputNames.find(n => n.includes("latent"))
                ?? _vae!.inputNames[0];

  const vaeOut = await _vae!.run({
    [lvName]: new o.Tensor("float32", new Float32Array(vaeIn), [1, 4, 64, 64]),
  });
  const imgRaw = vaeOut[_vae!.outputNames[0]].data as Float32Array; // [1,3,512,512]

  // 5. CHW Float32 → RGBA Canvas (denormalize [-1,1] → [0,255])
  onS?.("이미지 변환 중...");
  const W = 512, H = 512, N = W * H;
  const c   = document.createElement("canvas");
  c.width   = W;
  c.height  = H;
  const ctx = c.getContext("2d")!;
  const px  = ctx.createImageData(W, H);

  for (let i = 0; i < N; i++) {
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    px.data[i * 4]     = clamp((imgRaw[i]         / 2 + 0.5) * 255);
    px.data[i * 4 + 1] = clamp((imgRaw[i + N]     / 2 + 0.5) * 255);
    px.data[i * 4 + 2] = clamp((imgRaw[i + N * 2] / 2 + 0.5) * 255);
    px.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(px, 0, 0);

  // 6. 512×512 → 2048×1024 파노라마 타일링
  //    (SD-Turbo는 512×512 고정 → 가로 4회 타일로 파노라마 근사)
  const pano = document.createElement("canvas");
  pano.width  = 2048;
  pano.height = 1024;
  const pc = pano.getContext("2d")!;
  for (let x = 0; x < 2048; x += W) pc.drawImage(c, x,   0, W, H);
  for (let x = 0; x < 2048; x += W) pc.drawImage(c, x, 512, W, H);

  return pano.toDataURL("image/png");
}
