import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SkyboxGeneratorProps {
  onGenerated: (images: string[]) => void;
}

export const SkyboxGenerator = ({ onGenerated }: SkyboxGeneratorProps) => {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast({
        title: "프롬프트를 입력하세요",
        description: "스카이박스 생성을 위한 설명을 입력해주세요",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    
    try {
      // 6면 스카이박스 생성 (상, 하, 앞, 뒤, 왼쪽, 오른쪽)
      const faces = ["top", "bottom", "front", "back", "left", "right"];
      const generatedImages: string[] = [];

      for (const face of faces) {
        const facePrompt = `${prompt}, ${face} view of skybox, seamless texture, high quality`;
        
        // 임시로 플레이스홀더 사용 (실제로는 AI 이미지 생성 API 호출)
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = `hsl(${Math.random() * 360}, 70%, 50%)`;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = 'white';
          ctx.font = '48px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(face.toUpperCase(), canvas.width / 2, canvas.height / 2);
        }
        generatedImages.push(canvas.toDataURL('image/png'));
      }

      onGenerated(generatedImages);
      toast({
        title: "생성 완료!",
        description: "스카이박스가 성공적으로 생성되었습니다",
      });
    } catch (error) {
      toast({
        title: "생성 실패",
        description: "스카이박스 생성 중 오류가 발생했습니다",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
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
            원하는 스카이박스를 설명해주세요 (예: 석양이 지는 사막, 별이 빛나는 밤하늘)
          </p>
        </div>
        
        <div className="space-y-4">
          <Input
            id="prompt"
            placeholder="석양이 지는 푸른 하늘과 구름..."
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
        </div>
      </div>
    </div>
  );
};
