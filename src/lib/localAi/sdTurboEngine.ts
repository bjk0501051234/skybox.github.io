// src/lib/localAi/sdTurboEngine.ts
import { supabase } from "@/integrations/supabase/client";

type OrtMod = typeof import("onnxruntime-web");
type OrtSess = Awaited<ReturnType<OrtMod["InferenceSession"]["create"]>>;
type OrtTens = InstanceType<OrtMod["Tensor"]>;

// ── 모델 URL ────────────────────────────────────────────────────────────────
const URLS = {
  te: "https://huggingface.co/onnxruntime/sd-turbo/resolve/main/text_encoder/model.onnx",
  un: "https://huggingface.co/onnxruntime/sd-turbo/resolve/main/unet/model.onnx",
  vae: "https://huggingface.co/onnxruntime/sd-turbo/resolve/main/vae_decoder/model.onnx",
};

// ── DDPM 스케줄러 ────────────────────────────────────────────────────────────
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

let _ort: OrtMod  | null = null;
let _te:  OrtSess | null = null;
let _un:  OrtSess | null = null;
let _vae: OrtSess | null = null;
let _tok: any = null;

// ── Debug Helper ────────────────────────────────────────────────────────────
function debugLog(step: string, data?: any) {
  console.log(`🐞 [DEBUG] ${step}`, data || '');
}

// ── getOrt ──────────────────────────────────────────────────────────────────
async function getOrt(): Promise<OrtMod> {
  debugLog('1. getOrt 시작');
  if (!_ort) {
    debugLog('2. onnxruntime-web import 시작');
    _ort = await import("onnxruntime-web");
    _ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
    debugLog('3. onnxruntime-web import 완료');
  }
  return _ort;
}

// downloadModel 함수 - 프록시 사용!
async function downloadModel(url: string, onS?: (s: string) => void): Promise<ArrayBuffer> {
  debugLog('📥 [downloadModel] 시작', { url });

  const { data, error } = await supabase
    .from("user_api_keys")
    .select("api_key")
    .eq("provider", "huggingface")
    .single();

  debugLog('📥 [downloadModel] Supabase 응답', { data, error });

  const token = data?.api_key;
  if (!token) {
    debugLog('❌ [downloadModel] 토큰 없음!');
    throw new Error("❌ HuggingFace 토큰이 없습니다.");
  }

  onS?.(`다운로드: ${url.split("/").pop()}`);

  // 🔥 CORS-anywhere 프록시 사용 (no-cors 대신!)
  const PROXY = "https://cors-anywhere.herokuapp.com/";
  const proxiedUrl = PROXY + url;

  debugLog('📥 [downloadModel] 프록시 요청', { proxiedUrl });

  const response = await fetch(proxiedUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    mode: 'cors', // 🔥 CORS 모드 (프록시가 처리)
  });

  debugLog('📥 [downloadModel] 프록시 응답', {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  debugLog('✅ [downloadModel] 다운로드 완료!', {
    byteLength: arrayBuffer.byteLength,
    sizeMB: (arrayBuffer.byteLength / 1e6).toFixed(2) + ' MB'
  });

  return arrayBuffer;
}

// sdTurboEngine.ts - makeSession 함수 수정
async function makeSession(
  url: string,
  o: OrtMod,
  onS?: (s: string) => void
): Promise<OrtSess> {
  const buf = await downloadModel(url, onS);
  const opt = { graphOptimizationLevel: "all" as const };

  // 🔥 WebGPU 시도하지 않고 바로 WASM 사용!
  console.warn("[SD] GPU 메모리 부족 감지 → WASM 강제 사용!");
  onS?.("GPU 메모리 부족 → CPU(WASM) 모드로 전환 중...");
  
  return await o.InferenceSession.create(new Uint8Array(buf), {
    ...opt,
    executionProviders: ["wasm"], // 🔥 WASM 강제!
  });
}

// ── ensureModels ────────────────────────────────────────────────────────────
async function ensureModels(onS?: (s: string) => void) {
  debugLog('🔄 [ensureModels] 시작');
  const o = await getOrt();
  
  if (!_te) {
    debugLog('🔄 [ensureModels] text_encoder 로딩 시작');
    _te = await makeSession(URLS.te, o, onS);
  }
  if (!_un) {
    debugLog('🔄 [ensureModels] unet 로딩 시작');
    _un = await makeSession(URLS.un, o, onS);
  }
  if (!_vae) {
    debugLog('🔄 [ensureModels] vae_decoder 로딩 시작');
    _vae = await makeSession(URLS.vae, o, onS);
  }
  debugLog('✅ [ensureModels] 모든 모델 로딩 완료!');
}

// ── gaussianNoise ───────────────────────────────────────────────────────────
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

// ── generateWithSDTurbo ─────────────────────────────────────────────────────
export async function generateWithSDTurbo(
  prompt: string,
  onS?: (s: string) => void
): Promise<string> {
  debugLog('🚀 [generateWithSDTurbo] 시작');
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

  const result = pano.toDataURL("image/png");
  debugLog('✅ [generateWithSDTurbo] 완료!');
  return result;
}
