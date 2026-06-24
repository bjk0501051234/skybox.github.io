// src/lib/localAi/pollinationsEngine.ts
// ─────────────────────────────────────────────────────────────────────────────
// Pollinations 무료 API 로 (1) 프롬프트 변환 + (2) 스카이박스 이미지 생성.
//   - 설치 X, 디스크 X, GPU X, API 키 X, 돈 X.
//   - 텍스트·이미지 둘 다 Pollinations 서버가 처리 → 브라우저/내 PC 사양 무관.
//
// 이 파일 하나가 webllmPlanner.ts + sdTurboEngine.ts 를 둘 다 대체한다.
// SkyboxGenerator.tsx 의 import 1·2번 줄만 아래처럼 바꾸면 끝:
//
//   - import { planWithWebLLM } from "@/lib/localAi/webllmPlanner";
//   - import { generateWithSDTurbo } from "@/lib/localAi/sdTurboEngine";
//   + import { planWithPollinations as planWithWebLLM } from "@/lib/localAi/pollinationsEngine";
//   + import { generateWithPollinations as generateWithSDTurbo } from "@/lib/localAi/pollinationsEngine";
//
// (별칭(as)으로 가져오면 124·125번 줄 호출부는 손 안 대도 된다.)
// ─────────────────────────────────────────────────────────────────────────────

// ── 설정 (전부 여기서 튜닝) ────────────────────────────────────────────────────
const CONFIG = {
  // 무료 공개 엔드포인트. 둘 다 키 불필요.
  IMAGE_BASE: "https://image.pollinations.ai/prompt",
  TEXT_BASE: "https://text.pollinations.ai",

  // 이미지 모델: "flux"(고화질) / "turbo"(빠름). 하늘은 flux 추천.
  IMAGE_MODEL: "flux",
  // 텍스트(프롬프트 변환)용 모델.
  TEXT_MODEL: "openai",

  // 2:1 비율이 파노라마(equirectangular)에 가깝다.
  WIDTH: 1024,
  HEIGHT: 512,

  // 워터마크 제거 시도. 이미지가 아예 안 나오면 false 로.
  NOLOGO: true,

  // 변환 실패해도 항상 붙는 화질/파노라마 보강 접미사.
  QUALITY_SUFFIX:
    ", seamless 360 equirectangular panorama sky, ultra detailed, 8k, " +
    "cinematic lighting, no people, no text, no watermark",

  // 응답 대기 한도
  TEXT_TIMEOUT_MS: 30_000,
  IMAGE_TIMEOUT_MS: 120_000,
} as const;

function debugLog(step: string, data?: unknown) {
  console.log(`🐞 [Pollinations] ${step}`, data ?? "");
}

// 공통 fetch + 타임아웃
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (1) 프롬프트 변환  — planWithWebLLM 을 대체.  한글 → 영어 SD 프롬프트.
//     실패해도 절대 막지 않고 원문+접미사로 폴백한다 (생성이 멈추면 안 되니까).
// ─────────────────────────────────────────────────────────────────────────────
export async function planWithPollinations(
  koreanPrompt: string,
  onStatus?: (msg: string) => void
): Promise<string> {
  onStatus?.("AI 프롬프트 최적화 중...");

  const instruction =
    "Convert this Korean skybox description into ONE concise English " +
    "Stable Diffusion prompt. Output ONLY the English prompt, no quotes, " +
    "no explanation. Focus on sky, atmosphere, colors, lighting. " +
    "Korean description: " +
    koreanPrompt;

  try {
    const url = `${CONFIG.TEXT_BASE}/${encodeURIComponent(instruction)}?model=${CONFIG.TEXT_MODEL}`;
    const res = await fetchWithTimeout(url, CONFIG.TEXT_TIMEOUT_MS);
    if (!res.ok) throw new Error(`text HTTP ${res.status}`);

    const text = (await res.text()).trim();
    // 가끔 따옴표로 감싸서 오는 경우 정리
    const clean = text.replace(/^["'`]+|["'`]+$/g, "").trim();
    if (!clean) throw new Error("빈 응답");

    debugLog("✅ 프롬프트 변환", { in: koreanPrompt, out: clean });
    return clean;
  } catch (e) {
    // 변환 실패 → 원문 그대로 진행 (Flux 가 알아서 처리)
    debugLog("⚠️ 변환 실패 → 원문 사용", { error: (e as Error).message });
    return koreanPrompt;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (2) 이미지 생성  — generateWithSDTurbo 를 대체.  반환: data URL (string)
// ─────────────────────────────────────────────────────────────────────────────
function buildImageUrl(prompt: string, seed: number): string {
  const full = prompt + CONFIG.QUALITY_SUFFIX;
  const params = new URLSearchParams({
    width: String(CONFIG.WIDTH),
    height: String(CONFIG.HEIGHT),
    model: CONFIG.IMAGE_MODEL,
    seed: String(seed),
  });
  if (CONFIG.NOLOGO) params.set("nologo", "true");
  return `${CONFIG.IMAGE_BASE}/${encodeURIComponent(full)}?${params.toString()}`;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("이미지 디코드 실패"));
    fr.readAsDataURL(blob);
  });
}

export async function generateWithPollinations(
  prompt: string,
  onS?: (s: string) => void
): Promise<string> {
  const seed = Math.floor(Math.random() * 2 ** 32);
  const url = buildImageUrl(prompt, seed);
  debugLog("📥 이미지 요청", { model: CONFIG.IMAGE_MODEL, seed });

  onS?.("Pollinations 서버에 생성 요청 중...");

  try {
    const res = await fetchWithTimeout(url, CONFIG.IMAGE_TIMEOUT_MS);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Pollinations HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    onS?.("이미지 받아오는 중...");
    const blob = await res.blob();
    debugLog("✅ 수신 완료", { sizeKB: (blob.size / 1024).toFixed(1) + " KB" });

    return await blobToDataURL(blob);
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("Pollinations 응답 타임아웃 (서버 혼잡일 수 있음, 재시도)");
    }
    throw e;
  }
}
