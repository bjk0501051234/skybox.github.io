import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Cpu, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { panoramaToCubemap, createLocalSkyPanorama, FACE_ORDER, type FaceName } from "@/lib/equirectToCubemap";

interface SkyboxGeneratorProps {
  onGenerated: (images: string[]) => void;
}
interface Sticker { face: FaceName; description: string; }

type Provider = "lovable" | "gemini" | "huggingface";
type Selection = "local" | "auto" | Provider;

const PROVIDER_LABEL: Record<Provider, string> = {
  lovable: "Lovable AI (Gemini 2.5)",
  gemini: "Google Gemini (내 키)",
  huggingface: "HuggingFace (내 키)",
};

// ══════════════════════════════════════════════════════════════════════════════
//  로컬 WebGPU AI — 모듈 레벨 싱글턴 (컴포넌트 re-render 사이에도 유지됨)
//
//  라이브러리 : @huggingface/transformers  (npm install @huggingface/transformers)
//  모델       : Xenova/lcm-dreamshaper-v7  (~600 MB, IndexedDB 캐시)
//  대안 모델  : Xenova/sd-turbo (더 작음, guidance_scale=0.0, steps=1~4)
// ══════════════════════════════════════════════════════════════════════════════
let _pipe: unknown = null;
let _loadPromise: Promise<unknown> | null = null;

async function loadPipeline(onStatus: (s: string) => void): Promise<unknown> {
  if (_pipe) return _pipe;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    // ① WebGPU 지원 체크
    if (!("gpu" in navigator)) {
      throw new Error(
        "WebGPU 미지원 브라우저입니다. Chrome 113+ 또는 Edge 113+를 사용하세요."
      );
    }
    const adapter = await (navigator as { gpu: { requestAdapter: () => Promise<unknown> } })
      .gpu.requestAdapter();
    if (!adapter) {
      throw new Error("GPU 어댑터를 찾을 수 없습니다. 하드웨어 GPU가 필요합니다.");
    }

    // ② 라이브러리 동적 import (번들 분리 → 로컬 AI 미사용 시 로드 안 함)
    onStatus("📦 Transformers.js 모듈 로딩 중...");
    const { AutoPipelineForText2Image, env } = await import(
      "@huggingface/transformers"
    );

    // 원격 모델만 허용, IndexedDB 캐시 ON
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    // ③ 모델 로드 (첫 실행 시 HuggingFace Hub에서 다운로드 → IndexedDB 캐시)
    const pipe = await AutoPipelineForText2Image.from_pretrained(
      "Xenova/lcm-dreamshaper-v7",
      {
        dtype: "fp16",  // WebGPU fp16 추론
        device: "webgpu",
        progress_callback: (p: { status: string; progress?: number; file?: string }) => {
          if (p.status === "progress") {
            const pct = Math.round(p.progress ?? 0);
            onStatus(`⬇️ 모델 다운로드 ${pct}% … (첫 실행 후 캐시됨)`);
          } else if (p.status === "done") {
            onStatus(`✅ ${p.file ?? "모델"} 로드 완료`);
          } else if (p.status === "ready") {
            onStatus("🚀 파이프라인 준비 완료!");
          }
        },
      }
    );

    _pipe = pipe;
    _loadPromise = null;
    return pipe;
  })();

  return _loadPromise;
}

/** Stable Diffusion LCM으로 브라우저 내 이미지 생성 → base64 PNG 반환 */
async function runLocalDiffusion(
  prompt: string,
  onStatus: (s: string) => void
): Promise<string> {
  const pipe = await loadPipeline(onStatus);

  const enhancedPrompt =
    `${prompt}, seamless panoramic sky, 360 degree view, ` +
    "photorealistic, high quality, cinematic lighting, pure sky, no ground, no horizon line";

  onStatus("🎨 GPU 추론 중… (20초~3분, GPU 성능에 따라 다름)");

  // LCM 모델 최적 파라미터 (적은 스텝, 낮은 guidance)
  const output = await (pipe as (
    prompt: string,
    opts: Record<string, unknown>
  ) => Promise<unknown>)(enhancedPrompt, {
    num_inference_steps: 8,
    guidance_scale: 1.5,
    width: 512,
    height: 512,
  });

  // ── RawImage → HTMLCanvasElement → base64 ──────────────────────────────
  type RawImageLike = {
    toCanvas?: () => HTMLCanvasElement;
    width?: number;
    height?: number;
    data?: Uint8ClampedArray | number[];
    src?: string;
  };

  const raw = (
    Array.isArray(output)
      ? output[0]
      : (output as { images?: unknown[] })?.images?.[0] ?? output
  ) as RawImageLike;

  let canvas: HTMLCanvasElement;

  if (typeof raw?.toCanvas === "function") {
    // Transformers.js RawImage — 가장 일반적인 경로
    canvas = raw.toCanvas();
  } else if (raw instanceof HTMLCanvasElement) {
    canvas = raw;
  } else {
    // 폴백: ImageData 직접 구성
    const w = raw?.width ?? 512;
    const h = raw?.height ?? 512;
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;

    if (raw?.data) {
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(raw.data), w, h),
        0,
        0
      );
    } else if (raw?.src) {
      await new Promise<void>((res) => {
        const el = new Image();
        el.onload = () => { ctx.drawImage(el, 0, 0); res(); };
        el.src = raw.src!;
      });
    }
  }

  return canvas.toDataURL("image/png");
}

/**
 * 512×512 AI 이미지 → 1024×512 equirectangular 파노라마로 타일링
 * (좌우 이음새 소프트 블렌드 포함)
 */
function tileToEquirect(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      const cv = document.createElement("canvas");
      cv.width = w * 2;
      cv.height = h;
      const ctx = cv.getContext("2d")!;

      // 좌우 타일
      ctx.drawImage(img, 0, 0);
      ctx.drawImage(img, w, 0);

      // 이음새 블렌드 (96px 소프트 그라디언트)
      const g = ctx.createLinearGradient(w - 48, 0, w + 48, 0);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.5, "rgba(0,0,0,0.12)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(w - 48, 0, 96, h);

      resolve(cv.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = src;
  });
}
// ══════════════════════════════════════════════════════════════════════════════

export const SkyboxGenerator = ({ onGenerated }: SkyboxGeneratorProps) => {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [available, setAvailable] = useState<Provider[]>(["lovable"]);
  const [selected, setSelected] = useState<Selection>("local");
  const [gpuOk, setGpuOk] = useState<boolean | null>(null);
  const { toast } = useToast();

  // WebGPU 지원 여부 사전 체크
  useEffect(() => {
    setGpuOk("gpu" in navigator);
  }, []);

  // 사용자 API 키 로드
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setAvailable(["lovable"]); return; }
      const { data } = await supabase
        .from("user_api_keys")
        .select("provider")
        .eq("user_id", session.user.id);
      const s = new Set<Provider>(["lovable"]);
      for (const r of data ?? []) s.add(r.provider as Provider);
      setAvailable([...s]);
    })();
  }, []);

  const callEdge = async (body: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-skybox`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ ...body, provider: selected }),
      }
    );
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      throw new Error((e as { error?: string }).error || `Edge failed (${resp.status})`);
    }
    return resp.json();
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast({ title: "프롬프트를 입력하세요", variant: "destructive" });
      return;
    }
    setIsGenerating(true);
    try {
      let panorama: string;
      let stickers: Sticker[] = [];

      if (selected === "local") {
        // ── 로컬 WebGPU AI 경로 ────────────────────────────────────────────
        const raw = await runLocalDiffusion(prompt, setStatus);
        setStatus("이미지를 파노라마 형식으로 변환 중...");
        panorama = await tileToEquirect(raw);
      } else {
        // ── 클라우드 API 경로 (기존 그대로) ──────────────────────────────
        setStatus("순수 하늘 파노라마 생성 중...");
        const result = await callEdge({ action: "plan-and-panorama", prompt }) as {
          panorama: string;
          stickers: Sticker[];
        };
        panorama = result.panorama;
        stickers = result.stickers ?? [];
      }

      setStatus("파노라마를 6면 큐브맵으로 투영 중...");
      const faces = await panoramaToCubemap(panorama, 1024);

      if (stickers.length > 0) {
        const byFace = new Map<FaceName, string[]>();
        for (const s of stickers) {
          if (!byFace.has(s.face)) byFace.set(s.face, []);
          byFace.get(s.face)!.push(s.description);
        }
        let i = 0;
        for (const [face, descs] of byFace) {
          i++;
          setStatus(`${face.toUpperCase()} 면에 오브젝트 합성 중... (${i}/${byFace.size})`);
          const combined =
            descs.length === 1
              ? descs[0]
              : `Multiple elements: ${descs.map((d, j) => `(${j + 1}) ${d}`).join("; ")}`;
          const { image } = await callEdge({
            action: "sticker",
            face,
            description: combined,
            faceImage: faces[face],
          }) as { image: string };
          faces[face] = image;
        }
      }

      onGenerated(FACE_ORDER.map((f) => faces[f]));
      toast({
        title: "생성 완료!",
        description:
          selected === "local"
            ? "WebGPU 로컬 AI로 생성했습니다 🎉"
            : "스카이박스가 자연스럽게 연결되었습니다",
      });
    } catch (err) {
      console.error("Skybox generation error:", err);
      toast({
        title: "생성 실패",
        description: err instanceof Error ? err.message : "알 수 없는 오류",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
      setStatus("");
    }
  };

  const localBlocked = selected === "local" && gpuOk === false;

  return (
    <div className="gradient-card p-8 rounded-xl shadow-elevation border border-border/50">
      <div className="space-y-6">

        {/* 헤더 */}
        <div className="space-y-2">
          <Label className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI 스카이박스 생성
          </Label>

          <p className="text-sm text-muted-foreground">
            {selected === "local"
              ? "Transformers.js + WebGPU로 브라우저 안에서 실제 Stable Diffusion LCM을 실행합니다. 첫 실행 시 약 600 MB 다운로드 후 IndexedDB에 캐시됩니다."
              : "먼저 순수 하늘 1장을 만들고 6면으로 잘라 붙여 이음새를 없앤 뒤, 달·구름 같은 오브젝트만 면별로 자연스럽게 합성합니다."}
          </p>

          {/* WebGPU 상태 배지 */}
          {selected === "local" && gpuOk === false && (
            <p className="text-xs text-destructive font-medium">
              ⚠️ WebGPU 미지원 브라우저 — Chrome 113+ 또는 Edge 113+ 필요
            </p>
          )}
          {selected === "local" && gpuOk === true && (
            <p className="text-xs text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
              <Cpu className="h-3 w-3" /> WebGPU 사용 가능 · LCM DreamShaper v7
            </p>
          )}
          {selected !== "local" && (
            <p className="text-xs text-muted-foreground">
              예: "보라색 오로라 밤하늘, 왼쪽에 큰 보름달 하나, 앞면에 푹신한 구름 몇 개"
            </p>
          )}
        </div>

        {/* 폼 */}
        <div className="space-y-4">

          {/* AI 제공자 선택 */}
          <div className="space-y-2">
            <Label className="text-sm">AI 제공자 선택</Label>
            <Select
              value={selected}
              onValueChange={(v) => setSelected(v as Selection)}
              disabled={isGenerating}
            >
              <SelectTrigger className="h-11 bg-background/50 border-border/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">
                  🧠 로컬 AI (WebGPU · LCM · 완전 무료)
                </SelectItem>
                <SelectItem value="auto">자동 (우선순위대로 폴백)</SelectItem>
                {available.map((p) => (
                  <SelectItem key={p} value={p}>{PROVIDER_LABEL[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {selected === "local"
                ? "실제 AI 추론 · 서버·API 키·과금 없음 · 모델은 IndexedDB에 자동 캐시됩니다."
                : "클라우드 API를 통해 고품질 이미지를 생성합니다."}
            </p>
          </div>

          {/* 프롬프트 */}
          <Input
            id="prompt"
            placeholder="보라 오로라 하늘, 왼쪽에 큰 달 하나..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="h-12 bg-background/50 border-border/50 focus:border-primary transition-all"
            disabled={isGenerating}
          />

          {/* 생성 버튼 */}
          <Button
            onClick={handleGenerate}
            disabled={isGenerating || localBlocked}
            className="w-full h-12 gradient-primary hover:opacity-90 transition-all shadow-glow text-lg font-semibold"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                생성 중...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5" />
                스카이박스 생성
              </>
            )}
          </Button>

          {/* 진행 상태 */}
          {isGenerating && status && (
            <p className="text-sm text-muted-foreground text-center animate-pulse">
              {status}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
