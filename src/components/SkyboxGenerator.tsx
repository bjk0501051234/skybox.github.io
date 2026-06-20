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
import { Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { createLocalSkyPanorama, panoramaToCubemap, FACE_ORDER, type FaceName } from "@/lib/equirectToCubemap";
// ▼ 추가: 진짜 로컬 AI 엔진 (WebLLM 계획 + SD-Turbo WebGPU 이미지 생성)
import { generateLocalSkybox, isWebGpuAvailable } from "@/lib/localAi";

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

export const SkyboxGenerator = ({ onGenerated }: SkyboxGeneratorProps) => {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [available, setAvailable] = useState<Provider[]>(["lovable"]);
  const [selected, setSelected] = useState<Selection>("local");
  const { toast } = useToast();

  // Load which providers this user has keys for. Lovable is always available (managed key).
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setAvailable(["lovable"]);
        return;
      }
      const { data } = await supabase
        .from("user_api_keys")
        .select("provider")
        .eq("user_id", session.user.id);
      const set = new Set<Provider>(["lovable"]);
      for (const r of data ?? []) set.add(r.provider as Provider);
      setAvailable([...set]);
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
          "Authorization": `Bearer ${token}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ ...body, provider: selected }),
      },
    );
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      throw new Error(e.error || `Edge failed (${resp.status})`);
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
        // ── 진짜 로컬 AI: WebLLM(계획) + SD-Turbo(WebGPU 이미지 생성) ──
        // WebGPU 미지원 시 기존 Canvas 패턴 생성으로 자동 폴백.
        const result = await generateLocalSkybox(
          prompt,
          (msg) => setStatus(msg),
          (p) => createLocalSkyPanorama(p), // 폴백 함수
        );
        panorama = result.panorama;
        stickers = result.stickers; // 항상 [] → 아래 서버 합성 루프는 건너뜀
      } else {
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

      if (stickers && stickers.length > 0) {
        const byFace = new Map<FaceName, string[]>();
        for (const s of stickers) {
          if (!byFace.has(s.face)) byFace.set(s.face, []);
          byFace.get(s.face)!.push(s.description);
        }
        let i = 0;
        const total = byFace.size;
        for (const [face, descs] of byFace) {
          i++;
          setStatus(`${face.toUpperCase()} 면에 오브젝트 합성 중... (${i}/${total})`);
          const combined = descs.length === 1
            ? descs[0]
            : `Multiple elements on this face: ${descs.map((d, idx) => `(${idx + 1}) ${d}`).join("; ")}`;
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
      toast({ title: "생성 완료!", description: selected === "local" ? "브라우저 로컬 AI(WebGPU)로 생성했습니다" : "스카이박스가 자연스럽게 연결되었습니다" });
    } catch (error) {
      console.error("Skybox generation error:", error);
      toast({
        title: "생성 실패",
        description: error instanceof Error ? error.message : "오류 발생",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
      setStatus("");
    }
  };

  return (
    <div className="gradient-card p-8 rounded-xl shadow-elevation border border-border/50">
      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="prompt" className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI 스카이박스 생성
          </Label>
          <p className="text-sm text-muted-foreground">
            먼저 순수 하늘 1장을 만들고 6면으로 잘라 붙여 이음새를 없앤 뒤, 달·구름 같은 오브젝트만 면별로 자연스럽게 합성합니다.
          </p>
          <p className="text-xs text-muted-foreground">
            예: "보라색 오로라 밤하늘, 왼쪽에 큰 보름달 하나, 앞면에 푹신한 구름 몇 개"
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">AI 제공자 선택</Label>
            <Select value={selected} onValueChange={(v) => setSelected(v as Selection)} disabled={isGenerating}>
              <SelectTrigger className="h-11 bg-background/50 border-border/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">
                  로컬 AI · WebGPU {isWebGpuAvailable() ? "(사용 가능)" : "(미지원 → Canvas 폴백)"}
                </SelectItem>
                <SelectItem value="auto">자동 (우선순위대로 폴백)</SelectItem>
                {available.map((p) => (
                  <SelectItem key={p} value={p}>{PROVIDER_LABEL[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              로컬 AI는 WebLLM과 SD-Turbo를 브라우저 WebGPU에서 직접 실행합니다. 최초 1회 모델을 자동 다운로드(캐싱)하며 서버·API 키가 필요 없습니다.
            </p>
          </div>

          <Input
            id="prompt"
            placeholder="보라 오로라 하늘, 왼쪽에 큰 달 하나..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="h-12 bg-background/50 border-border/50 focus:border-primary transition-all"
            disabled={isGenerating}
          />

          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
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

          {isGenerating && status && (
            <p className="text-sm text-muted-foreground text-center animate-pulse">{status}</p>
          )}
        </div>
      </div>
    </div>
  );
};
