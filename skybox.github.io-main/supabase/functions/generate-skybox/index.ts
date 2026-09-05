// ============================================================================
//  index.ts  (localAi)
//  WebLLM(계획) + SD-Turbo(이미지)를 묶어서 컴포넌트가 쓰던
//  { panorama, stickers } 모양 그대로 돌려준다. 기존 파이프라인과 100% 호환.
//
//  흐름: 한국어 프롬프트
//        → WebLLM이 영어 diffusion 프롬프트로 변환
//        → SD-Turbo가 그 프롬프트로 하늘 파노라마 생성
//        → 기존 panoramaToCubemap 투영으로 그대로 연결
//
//  stickers는 빈 배열로 반환 → 기존 컴포넌트의 서버 sticker 합성 루프를
//  건너뛰어 "완전 로컬"을 보장한다. (면별 로컬 합성은 다음 단계 후보)
// ============================================================================

import { planSkybox, type ProgressCb, type FaceName } from "./webllmPlanner";
import { generateImage, isWebGpuAvailable } from "./sdTurboEngine";

export interface LocalSkyboxResult {
  panorama: string; // dataURL
  stickers: { face: FaceName; description: string }[];
  engine: "ai" | "canvas-fallback";
}

export { isWebGpuAvailable };

export async function generateLocalSkybox(
  userPrompt: string,
  onProgress?: ProgressCb,
  canvasFallback?: (prompt: string) => string,
): Promise<LocalSkyboxResult> {
  // WebGPU 없는 환경(구형 브라우저/사파리 일부)에선 기존 Canvas로 안전 폴백
  if (!isWebGpuAvailable()) {
    if (!canvasFallback) {
      throw new Error(
        "이 브라우저는 WebGPU를 지원하지 않습니다. Chrome/Edge 최신 버전을 쓰거나 다른 제공자를 선택하세요.",
      );
    }
    onProgress?.("WebGPU 미지원 → 로컬 Canvas로 폴백");
    return { panorama: canvasFallback(userPrompt), stickers: [], engine: "canvas-fallback" };
  }

  try {
    // 1) WebLLM: 한국어 → 영어 diffusion 프롬프트 + 장면 계획
    const plan = await planSkybox(userPrompt, onProgress);

    // 2) SD-Turbo: 프롬프트로 실제 하늘 이미지 생성
    const fullPrompt = plan.panoramaPrompt;
    const panorama = await generateImage(fullPrompt, { onProgress });

    // stickers는 메타로만 보유, 서버 합성 루프는 타지 않도록 빈 배열 반환
    return { panorama, stickers: [], engine: "ai" };
  } catch (err) {
    console.error("[localAi] 실패:", err);
    if (canvasFallback) {
      onProgress?.("AI 생성 실패 → Canvas로 폴백");
      return { panorama: canvasFallback(userPrompt), stickers: [], engine: "canvas-fallback" };
    }
    throw err;
  }
}
