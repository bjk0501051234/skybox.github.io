// GTX 1080 (no shader-f16) → q4f32_1 자동 선택
type MlcEngine = Awaited<ReturnType
  Awaited<typeof import("@mlc-ai/web-llm")>["CreateMLCEngine"]
>>;

let _engine: MlcEngine | null = null;

async function pickModel(): Promise<string> {
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    return adapter?.features.has("shader-f16")
      ? "Phi-3.5-mini-instruct-q4f16_1-MLC"
      : "Phi-3.5-mini-instruct-q4f32_1-MLC"; // Pascal용
  } catch {
    return "Phi-3.5-mini-instruct-q4f32_1-MLC";
  }
}

export async function planWithWebLLM(
  koreanPrompt: string,
  onStatus?: (msg: string) => void
): Promise<string> {
  if (!_engine) {
    const modelId = await pickModel();
    onStatus?.(`WebLLM (${modelId}) 초기화 중... 최초 1회 ~1GB`);
    const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
    _engine = await CreateMLCEngine(modelId, {
      initProgressCallback: (info) => {
        const p = Math.round(info.progress * 100);
        onStatus?.(`WebLLM 다운로드 ${p}%... (이후 캐싱)`);
      },
    });
  }

  onStatus?.("AI 프롬프트 최적화 중...");
  const res = await _engine.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "Convert Korean skybox descriptions into concise English Stable Diffusion prompts. " +
          "Output ONLY the English prompt. Focus on sky, atmosphere, colors, lighting. " +
          'Always append: ", equirectangular panorama, seamless 360 skybox, photorealistic, 8k"',
      },
      { role: "user", content: koreanPrompt },
    ],
    temperature: 0.6,
    max_tokens: 120,
  });
  const out = res.choices[0].message.content?.trim() ?? koreanPrompt;
  console.log("[WebLLM] →", out);
  return out;
}