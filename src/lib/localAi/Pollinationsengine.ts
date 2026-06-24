// src/lib/localAi/pollinationsEngine.ts
// ─────────────────────────────────────────────────────────────────────────────
// Pollinations 무료 이미지 API 로 스카이박스(파노라마) 생성.
//   - 설치 X, 디스크 X, GPU X, API 키 X, 돈 X.
//   - 생성은 Pollinations 서버가 처리 → 내 PC 사양과 무관.
//
// sdTurboEngine.ts 의 generateWithSDTurbo 와 시그니처가 동일하므로
// SkyboxGenerator.tsx 의 import 한 줄만 바꾸면 그대로 교체된다.
//
//   - import { generateWithSDTurbo } from "@/lib/localAi/sdTurboEngine";
//   + import { generateWithPollinations as generateWithSDTurbo } from "@/lib/localAi/pollinationsEngine";
//
// 반환값: PNG/JPEG data URL (string). panoramaToCubemap 이 그대로 소비한다.
// ─────────────────────────────────────────────────────────────────────────────

// ── 설정 (전부 여기서 튜닝) ────────────────────────────────────────────────────
const CONFIG = {
  // 무료 공개 이미지 엔드포인트. 키 불필요.
  BASE: "https://image.pollinations.ai/prompt",

  // 모델: "flux"(고화질, 약간 느림) / "turbo"(빠름) 중 택. 하늘은 flux 추천.
  MODEL: "flux",

  // 2:1 비율이 파노라마(equirectangular)에 가깝다.
  WIDTH: 1024,
  HEIGHT: 512,

  // 워터마크 제거 시도. 만약 이미지가 안 나오면 false 로 바꿔봐.
  NOLOGO: true,

  // 하늘 파노라마용 화질 보강 접미사. (이 엔드포인트엔 네거티브 칸이 없어서
  //  프롬프트 뒤에 품질 키워드를 직접 붙여준다.)
  QUALITY_SUFFIX:
    ", seamless 360 equirectangular panorama sky, ultra detailed, 8k, " +
    "cinematic lighting, no people, no text, no watermark",

  // 응답 대기 한도 (flux 는 5~30초 걸릴 수 있음)
  TIMEOUT_MS: 120_000,
} as const;

// ── 로깅 ──────────────────────────────────────────────────────────────────────
function debugLog(step: string, data?: unknown) {
  console.log(`🐞 [Pollinations] ${step}`, data ?? "");
}

// ── URL 조립 ──────────────────────────────────────────────────────────────────
function buildUrl(prompt: string, seed: number): string {
  const full = prompt + CONFIG.QUALITY_SUFFIX;
  const params = new URLSearchParams({
    width: String(CONFIG.WIDTH),
    height: String(CONFIG.HEIGHT),
    model: CONFIG.MODEL,
    seed: String(seed),
  });
  if (CONFIG.NOLOGO) params.set("nologo", "true");
  return `${CONFIG.BASE}/${encodeURIComponent(full)}?${params.toString()}`;
}

// ── Blob → data URL (canvas taint 방지 위해 dataURL 로 반환) ───────────────────
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("이미지 디코드 실패"));
    fr.readAsDataURL(blob);
  });
}

// ── 메인: sdTurboEngine 와 동일한 시그니처 ─────────────────────────────────────
export async function generateWithPollinations(
  prompt: string,
  onS?: (s: string) => void
): Promise<string> {
  const seed = Math.floor(Math.random() * 2 ** 32);
  const url = buildUrl(prompt, seed);
  debugLog("📥 생성 요청", { model: CONFIG.MODEL, seed });

  onS?.("Pollinations 서버에 생성 요청 중...");

  // 타임아웃 처리
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: ctrl.signal });
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
  } finally {
    clearTimeout(timer);
  }
}
