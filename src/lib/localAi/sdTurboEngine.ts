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

// ── downloadModel (Debug Ver.) ─────────────────────────────────────────────
async function downloadModel(url: string, onS?: (s: string) => void): Promise<ArrayBuffer> {
  debugLog('📥 [downloadModel] 시작', { url });

  // 1. Supabase 조회
  debugLog('📥 [downloadModel] Supabase 토큰 조회 중...');
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
  debugLog('✅ [downloadModel] 토큰 확인', token.slice(0, 10) + '...');

  onS?.(`다운로드: ${url.split("/").pop()}`);

  // 2. fetch 요청
  debugLog('📥 [downloadModel] fetch 시작', { url });
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  debugLog('📥 [downloadModel] fetch 응답', {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
  });

  if (!response.ok) {
    debugLog('❌ [downloadModel] HTTP 에러!', response.status);
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  // 3. ArrayBuffer 변환
  const arrayBuffer = await response.arrayBuffer();
  debugLog('✅ [downloadModel] 다운로드 완료!', {
    byteLength: arrayBuffer.byteLength,
    sizeMB: (arrayBuffer.byteLength / 1e6).toFixed(2) + ' MB'
  });

  return arrayBuffer;
}

// ── makeSession ─────────────────────────────────────────────────────────────
async function makeSession(
  url: string,
  o: OrtMod,
  onS?: (s: string) => void
): Promise<OrtSess> {
  debugLog('🔧 [makeSession] 시작', { url });
  
  const buf = await downloadModel(url, onS);
  debugLog('🔧 [makeSession] downloadModel 완료, 버퍼 크기:', buf.byteLength);

  const opt = { graphOptimizationLevel: "all" as const };

  try {
    debugLog('🔧 [makeSession] WebGPU 세션 생성 시도...');
    const session = await o.InferenceSession.create(new Uint8Array(buf), {
      ...opt,
      executionProviders: ["webgpu"],
    });
    debugLog('✅ [makeSession] WebGPU 세션 생성 성공!');
    return session;
  } catch (e) {
    console.warn("[SD] WebGPU 실패 → WASM 폴백:", e);
    debugLog('🔧 [makeSession] WebGPU 실패, WASM 폴백 시도...');
    const session = await o.InferenceSession.create(new Uint8Array(buf), {
      ...opt,
      executionProviders: ["wasm"],
    });
    debugLog('✅ [makeSession] WASM 세션 생성 성공!');
    return session;
  }
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

  // ... (이후 코드는 동일)
  // 여기서부터는 이전 코드와 동일하게 유지
  // (1. 토크나이즈 ~ 6. 파노라마 변환)
  
  // 임시 반환 (실제 코드에서는 아래 주석 해제)
  // return pano.toDataURL("image/png");
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}
