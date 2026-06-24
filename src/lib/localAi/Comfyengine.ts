// src/lib/localAi/comfyEngine.ts
// ─────────────────────────────────────────────────────────────────────────────
// 로컬 ComfyUI 서버로 스카이박스(파노라마) 생성.
// sdTurboEngine.ts 의 generateWithSDTurbo 와 시그니처가 동일하므로
// SkyboxGenerator.tsx 의 import 한 줄만 바꾸면 그대로 교체된다.
//
//   - import { generateWithSDTurbo } from "@/lib/localAi/sdTurboEngine";
//   + import { generateWithComfy as generateWithSDTurbo } from "@/lib/localAi/comfyEngine";
//
// 반환값: PNG data URL (string). panoramaToCubemap 이 그대로 소비한다.
// ─────────────────────────────────────────────────────────────────────────────

// ── 설정 (전부 여기서 튜닝) ────────────────────────────────────────────────────
const CONFIG = {
  // ComfyUI 주소. 로컬이면 "http://127.0.0.1:8188",
  // cloudflared 터널 쓰면 "https://xxxx.trycloudflare.com" 로 바꿔라.
  // (Lovable 같은 https 페이지 → http://localhost 는 mixed-content 로 막힐 수 있어서
  //  터널로 https 끝점을 만드는 게 가장 안전하다. 아래 사용법 참고.)
  SERVER: (import.meta.env.VITE_COMFY_URL as string) || "http://127.0.0.1:8188",

  // 체크포인트 파일명 (ComfyUI/models/checkpoints/ 안의 정확한 파일명)
  CHECKPOINT: "sd_turbo.safetensors",

  // 출력 해상도. 2:1 비율이 파노라마(equirectangular)에 가깝다.
  WIDTH: 1024,
  HEIGHT: 512,

  // SD-Turbo 기본값: steps 적게, cfg 1.x. 일반 SD1.5 체크포인트면 steps 20 / cfg 7 로.
  STEPS: 4,
  CFG: 1.5,
  SAMPLER: "dpmpp_sde",
  SCHEDULER: "karras",

  // 하늘 파노라마라 인물/텍스트/워터마크 등은 네거티브로 눌러둔다.
  NEGATIVE:
    "people, person, text, watermark, signature, logo, frame, border, " +
    "blurry, lowres, jpeg artifacts, seam, duplicate, deformed",

  // 진행 폴링/타임아웃
  TIMEOUT_MS: 180_000,
} as const;

// ── 로깅 ──────────────────────────────────────────────────────────────────────
function debugLog(step: string, data?: unknown) {
  console.log(`🐞 [Comfy] ${step}`, data ?? "");
}

// ── 워크플로우 템플릿 (ComfyUI API 포맷) ───────────────────────────────────────
// 표준 SD1.5 txt2img 그래프. 프롬프트/시드만 런타임에 주입한다.
function buildWorkflow(prompt: string, seed: number): Record<string, unknown> {
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: CONFIG.STEPS,
        cfg: CONFIG.CFG,
        sampler_name: CONFIG.SAMPLER,
        scheduler: CONFIG.SCHEDULER,
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: CONFIG.CHECKPOINT },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: CONFIG.WIDTH, height: CONFIG.HEIGHT, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: CONFIG.NEGATIVE, clip: ["4", 1] },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "skybox", images: ["8", 0] },
    },
  };
}

// ── 1) 워크플로우 큐 등록 → prompt_id 획득 ─────────────────────────────────────
async function queuePrompt(
  workflow: Record<string, unknown>,
  clientId: string
): Promise<string> {
  const res = await fetch(`${CONFIG.SERVER}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComfyUI /prompt ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { prompt_id?: string; error?: unknown };
  if (!json.prompt_id) {
    throw new Error(`ComfyUI 큐 등록 실패: ${JSON.stringify(json.error ?? json)}`);
  }
  return json.prompt_id;
}

// ── 2) WebSocket 으로 실시간 진행률 추적 → 완료 대기 ──────────────────────────
function trackProgress(
  clientId: string,
  promptId: string,
  onS?: (s: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    // http(s) → ws(s) 변환
    const wsUrl =
      CONFIG.SERVER.replace(/^http/, "ws") + `/ws?clientId=${clientId}`;
    const ws = new WebSocket(wsUrl);

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("ComfyUI 응답 타임아웃"));
    }, CONFIG.TIMEOUT_MS);

    const done = () => {
      clearTimeout(timer);
      ws.close();
      resolve();
    };

    ws.onmessage = (ev) => {
      // 바이너리(프리뷰 이미지) 프레임은 무시
      if (typeof ev.data !== "string") return;

      let msg: { type?: string; data?: any };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (msg.type === "progress" && msg.data) {
        const { value, max } = msg.data;
        if (max > 0) onS?.(`생성 중... ${Math.round((value / max) * 100)}%`);
      }

      // 우리 prompt 의 실행이 끝나면 node 가 null 로 온다
      if (
        msg.type === "executing" &&
        msg.data?.node === null &&
        msg.data?.prompt_id === promptId
      ) {
        debugLog("✅ 실행 완료", { promptId });
        done();
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("ComfyUI WebSocket 에러 (서버/CORS/터널 확인)"));
    };
  });
}

// ── 3) /history 에서 결과 파일명 추출 → /view 로 이미지 바이트 획득 ────────────
async function fetchResultImage(promptId: string): Promise<Blob> {
  const res = await fetch(`${CONFIG.SERVER}/history/${promptId}`);
  if (!res.ok) throw new Error(`ComfyUI /history ${res.status}`);

  const hist = (await res.json()) as Record<string, any>;
  const outputs = hist[promptId]?.outputs ?? {};

  // SaveImage 노드 출력에서 첫 이미지 파일 정보를 찾는다
  for (const nodeId of Object.keys(outputs)) {
    const images = outputs[nodeId]?.images;
    if (Array.isArray(images) && images.length > 0) {
      const { filename, subfolder, type } = images[0];
      const q = new URLSearchParams({
        filename,
        subfolder: subfolder ?? "",
        type: type ?? "output",
      });
      const img = await fetch(`${CONFIG.SERVER}/view?${q.toString()}`);
      if (!img.ok) throw new Error(`ComfyUI /view ${img.status}`);
      return await img.blob();
    }
  }
  throw new Error("ComfyUI 결과 이미지를 찾지 못함 (워크플로우에 SaveImage 있는지 확인)");
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
export async function generateWithComfy(
  prompt: string,
  onS?: (s: string) => void
): Promise<string> {
  const clientId = crypto.randomUUID();
  const seed = Math.floor(Math.random() * 2 ** 32);

  debugLog("📥 생성 시작", { server: CONFIG.SERVER, seed });
  onS?.("ComfyUI 서버에 작업 등록 중...");

  const workflow = buildWorkflow(prompt, seed);
  const promptId = await queuePrompt(workflow, clientId);

  onS?.("생성 대기 중...");
  await trackProgress(clientId, promptId, onS);

  onS?.("이미지 가져오는 중...");
  const blob = await fetchResultImage(promptId);

  return await blobToDataURL(blob);
}
