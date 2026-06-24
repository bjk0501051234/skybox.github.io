// src/lib/localAi/pollinationsEngine.ts
// ─────────────────────────────────────────────────────────────────────────────
// Pollinations 무료 API 로 (1) 프롬프트 변환 + (2) 스카이박스 이미지 생성.
//   - 설치 X, 디스크 X, GPU X, 돈 X.
//   - 단, 현재 Pollinations 는 가입 + 공개키(pk_)가 필요하다 (익명은 Turnstile 로 막힘).
//     → enter.pollinations.ai 에서 무료 App Key(pk_...) 발급받아
//       Lovable 환경변수 VITE_POLLINATIONS_KEY 에 넣어라. pk_ 는 브라우저 노출 OK.
//
// 이 파일 하나가 webllmPlanner.ts + sdTurboEngine.ts 를 둘 다 대체한다.
// SkyboxGenerator.tsx 1·2번 줄을 아래처럼 별칭 import 로 바꾸면 호출부는 손 안 댐:
//   import { planWithPollinations as planWithWebLLM } from "@/lib/localAi/pollinationsEngine";
//   import { generateWithPollinations as generateWithSDTurbo } from "@/lib/localAi/pollinationsEngine";
// ─────────────────────────────────────────────────────────────────────────────

// ── 설정 ──────────────────────────────────────────────────────────────────────
const CONFIG = {
  IMAGE_BASE: "https://image.pollinations.ai/prompt",
  TEXT_BASE: "https://text.pollinations.ai",

  // ⭐ enter.pollinations.ai 에서 발급한 공개키(pk_...). 없으면 403 난다.
  KEY: (import.meta.env.VITE_POLLINATIONS_KEY as string) || "",

  IMAGE_MODEL: "flux", // "flux"(고화질) / "turbo"(빠름)
  TEXT_MODEL: "openai",

  WIDTH: 1024,
  HEIGHT: 512,
  NOLOGO: true,

  QUALITY_SUFFIX:
    ", seamless 360 equirectangular panorama sky, ultra detailed, 8k, " +
    "cinematic lighting, no people, no text, no watermark",

  TEXT_TIMEOUT_MS: 30_000,
  IMAGE_TIMEOUT_MS: 120_000,
} as const;

function debugLog(step: string, data?: unknown) {
  console.log(`🐞 [Pollinations] ${step}`, data ?? "");
}

// 키를 쿼리에 붙인다 (GET 엔드포인트는 헤더 대신 ?key= 사용)
function withKey(params: URLSearchParams): URLSearchParams {
  if (CONFIG.KEY) params.set("key", CONFIG.KEY);
  return params;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 403/Turnstile 공통 안내 메시지
function explain403(status: number, body: string): string {
  if (status === 403 && /turnstile|missing.*token|forbidden/i.test(body)) {
    return (
      "Pollinations 인증 실패(403). enter.pollinations.ai 에서 공개키(pk_)를 발급받아 " +
      "Lovable 환경변수 VITE_POLLINATIONS_KEY 에 넣고 재배포해라."
    );
  }
  return `Pollinations HTTP ${status}: ${body.slice(0, 200)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// (1) 프롬프트 변환  — planWithWebLLM 대체.  실패해도 원문으로 폴백(생성 안 멈춤).
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
    const params = withKey(new URLSearchParams({ model: CONFIG.TEXT_MODEL }));
    const url = `${CONFIG.TEXT_BASE}/${encodeURIComponent(instruction)}?${params.toString()}`;
    const res = await fetchWithTimeout(url, CONFIG.TEXT_TIMEOUT_MS);
    if (!res.ok) throw new Error(`text HTTP ${res.status}`);

    const text = (await res.text()).trim();
    const clean = text.replace(/^["'`]+|["'`]+$/g, "").trim();
    if (!clean) throw new Error("빈 응답");

    debugLog("✅ 프롬프트 변환", { in: koreanPrompt, out: clean });
    return clean;
  } catch (e) {
    debugLog("⚠️ 변환 실패 → 원문 사용", { error: (e as Error).message });
    return koreanPrompt; // 영어 변환 못 해도 이미지 단계는 진행
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (2) 이미지 생성  — generateWithSDTurbo 대체.  반환: data URL (string)
// ─────────────────────────────────────────────────────────────────────────────
function buildImageUrl(prompt: string, seed: number): string {
  const full = prompt + CONFIG.QUALITY_SUFFIX;
  const params = withKey(
    new URLSearchParams({
      width: String(CONFIG.WIDTH),
      height: String(CONFIG.HEIGHT),
      model: CONFIG.IMAGE_MODEL,
      seed: String(seed),
    })
  );
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
  debugLog("📥 이미지 요청", { model: CONFIG.IMAGE_MODEL, seed, hasKey: !!CONFIG.KEY });

  onS?.("Pollinations 서버에 생성 요청 중...");

  try {
    const res = await fetchWithTimeout(url, CONFIG.IMAGE_TIMEOUT_MS);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(explain403(res.status, text));
    }

    onS?.("이미지 받아오는 중...");
    const blob = await res.blob();
    debugLog("✅ 수신 완료", { sizeKB: (blob.size / 1024).toFixed(1) + " KB" });

    return await blobToDataURL(blob);
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("Pollinations 응답 타임아웃 (서버 혼잡, 재시도)");
    }
    throw e;
  }
}
