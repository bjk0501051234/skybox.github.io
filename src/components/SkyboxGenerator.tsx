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
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-skybox`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ prompt }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate skybox');
      }

      const data = await response.json();
      
      if (!data.crossLayoutImage) {
        throw new Error('Invalid response from server');
      }

      // Load the cross layout image
      const img = new Image();
      img.crossOrigin = "anonymous";
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = data.crossLayoutImage;
      });

      // Create canvas to slice the cross layout into 6 faces
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get canvas context');

      // Each face is 512x512
      canvas.width = 512;
      canvas.height = 512;

      const faces: string[] = [];
      
      // Cross layout positions (in the 2048x1536 image):
      //        [top]           x:512, y:0
      // [left][front][right][back]  y:512, x: 0,512,1024,1536
      //        [bottom]        x:512, y:1024
      
      const facePositions = [
        { name: 'top', sx: 512, sy: 0 },      // top
        { name: 'bottom', sx: 512, sy: 1024 }, // bottom
        { name: 'front', sx: 512, sy: 512 },   // front
        { name: 'back', sx: 1536, sy: 512 },   // back
        { name: 'left', sx: 0, sy: 512 },      // left
        { name: 'right', sx: 1024, sy: 512 },  // right
      ];

      for (const pos of facePositions) {
        ctx.clearRect(0, 0, 512, 512);
        ctx.drawImage(
          img,
          pos.sx, pos.sy, 512, 512,  // source position and size
          0, 0, 512, 512             // destination position and size
        );
        faces.push(canvas.toDataURL('image/png'));
      }

      onGenerated(faces);
      toast({
        title: "생성 완료!",
        description: "스카이박스가 성공적으로 생성되었습니다",
      });
    } catch (error) {
      console.error('Skybox generation error:', error);
      toast({
        title: "생성 실패",
        description: error instanceof Error ? error.message : "스카이박스 생성 중 오류가 발생했습니다",
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
