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

function debugLog(step: string, data?: any) {
  console.log(`🐞 [DEBUG] ${step}`, data || '');
}

async function getOrt(): Promise<OrtMod> {
  if (!_ort) {
    _ort = await import("onnxruntime-web");
    _ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
  }
  return _ort;
}

// ── 🔥 XHR 다운로드 (마지막 희망) ─────────────────────────────────────────────
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
    throw new Error("❌ HuggingFace 토큰이 없습니다.");
  }

  onS?.(`다운로드: ${url.split("/").pop()}`);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'arraybuffer';

    xhr.onprogress = (event) => {
      if (event.total > 0 && onS) {
        const pct = Math.round((event.loaded / event.total) * 100);
        onS?.(`${pct}% (${(event.loaded / 1e6).toFixed(1)} MB)`);
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 206) {
        debugLog('✅ [downloadModel] XHR 성공!', {
          byteLength: xhr.response.byteLength,
          sizeMB: (xhr.response.byteLength / 1e6).toFixed(2) + ' MB'
        });
        resolve(xhr.response);
      } else if (xhr.status === 403) {
        reject(new Error("❌ HuggingFace 토큰이 유효하지 않습니다."));
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${url}`));
      }
    };

    xhr.onerror = () => {
      debugLog('❌ [downloadModel] XHR 네트워크 에러!');
      reject(new Error('Network error (XHR)'));
    };

    xhr.send();
  });
}

// ── makeSession ─────────────────────────────────────────────────────────────
async function makeSession(
  url: string,
  o: OrtMod,
  onS?: (s: string) => void
): Promise<OrtSess> {
  const buf = await downloadModel(url, onS);
  const opt = { graphOptimizationLevel: "all" as const };

  try {
    onS?.("GPU(WebGPU) 모드 시도 중...");
    return await o.InferenceSession.create(new Uint8Array(buf), {
      ...opt,
      executionProviders: ["webgpu"],
    });
  } catch (e) {
    console.warn("[SD] WebGPU 실패 → WASM(CPU) 폴백:", e);
    onS?.("GPU 메모리 부족 → CPU(WASM) 모드로 전환 중...");
    return await o.InferenceSession.create(new Uint8Array(buf), {
      ...opt,
      executionProviders: ["wasm"],
    });
  }
}

async function ensureModels(onS?: (s: string) => void) {
  const o = await getOrt();
  if (!_te) { onS?.("[1/3] 텍스트 인코더 로딩..."); _te = await makeSession(URLS.te, o, onS); }
  if (!_un) { onS?.("[2/3] UNet 로딩 (~1.7 GB)..."); _un = await makeSession(URLS.un, o, onS); }
  if (!_vae) { onS?.("[3/3] VAE 디코더 로딩..."); _vae = await makeSession(URLS.vae, o, onS); }
}

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
  const o = await getOrt();
  await ensureModels(onS);

  onS?.("텍스트 토크나이즈 중...");
  if (!_tok) {
    const { CLIPTokenizer } = await import("@huggingface/transformers");
    _tok = await CLIPTokenizer.from_pretrained("openai/clip-vit-large-patch14");
  }
  const enc = _tok(prompt, { padding: "max_length", max_length: 77, truncation: true });
  const ids = Array.from(enc.input_ids.data as Int32Array).map(Number);

  onS?.("텍스트 인코딩 중...");
  const inputIdsTensor: OrtTens = new o.Tensor("int32", new Int32Array(ids), [1, 77]);
  const teOut = await _te!.run({ [_te!.inputNames[0]]: inputIdsTensor });
  const textEmb = teOut[_te!.outputNames[0]];

  onS?.("UNet 추론 중...");
  const T = 999, a = ALPHA_CP[T], sqA = Math.sqrt(a), sqoA = Math.sqrt(1 - a);
  const L = 4 * 64 * 64;
  const latent = gaussianNoise(L).map(n => n * (sqoA / sqA));

  const sName = _un!.inputNames.find(n => n === "sample") ?? _un!.inputNames[0];
  const tName = _un!.inputNames.find(n => n.includes("timestep")) ?? _un!.inputNames[1];
  const eName = _un!.inputNames.find(n => n.includes("encoder_hidden")) ?? _un!.inputNames[2];

  const unetInput: Record<string, OrtTens> = {
    [sName]: new o.Tensor("float32", new Float32Array(latent), [1, 4, 64, 64]),
    [tName]: new o.Tensor("float32", new Float32Array([T]), [1]),
    [eName]: textEmb,
  };

  const unOut = await _un!.run(unetInput);
  const pred = unOut[_un!.outputNames.find(n => n.includes("sample")) ?? _un!.outputNames[0]].data as Float32Array;

  const x0 = new Float32Array(L);
  for (let i = 0; i < L; i++) x0[i] = (latent[i] - sqoA * pred[i]) / sqA;

  onS?.("VAE 디코딩 중...");
  const VAE_SCALE = 0.18215;
  const vaeIn = x0.map(v => v / VAE_SCALE);
  const lvName = _vae!.inputNames.find(n => n.includes("latent")) ?? _vae!.inputNames[0];
  const vaeOut = await _vae!.run({ [lvName]: new o.Tensor("float32", new Float32Array(vaeIn), [1, 4, 64, 64]) });
  const imgRaw = vaeOut[_vae!.outputNames[0]].data as Float32Array;

  onS?.("이미지 변환 중...");
  const W = 512, H = 512, N = W * H;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const px = ctx.createImageData(W, H);

  for (let i = 0; i < N; i++) {
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    px.data[i * 4] = clamp((imgRaw[i] / 2 + 0.5) * 255);
    px.data[i * 4 + 1] = clamp((imgRaw[i + N] / 2 + 0.5) * 255);
    px.data[i * 4 + 2] = clamp((imgRaw[i + N * 2] / 2 + 0.5) * 255);
    px.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(px, 0, 0);

  const pano = document.createElement("canvas");
  pano.width = 2048; pano.height = 1024;
  const pc = pano.getContext("2d")!;
  for (let x = 0; x < 2048; x += W) pc.drawImage(c, x, 0, W, H);
  for (let x = 0; x < 2048; x += W) pc.drawImage(c, x, 512, W, H);

  return pano.toDataURL("image/png");
}
