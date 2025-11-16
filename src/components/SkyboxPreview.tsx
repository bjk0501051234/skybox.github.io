import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface SkyboxPreviewProps {
  images: string[];
}

const faceNames = ["top", "bottom", "front", "back", "left", "right"];
const robloxNames = ["SkyboxUp", "SkyboxDn", "SkyboxFt", "SkyboxBk", "SkyboxLf", "SkyboxRt"];

export const SkyboxPreview = ({ images }: SkyboxPreviewProps) => {
  const [isConverting, setIsConverting] = useState(false);
  const { toast } = useToast();

  const convertAndDownload = async () => {
    if (images.length !== 6) {
      toast({
        title: "오류",
        description: "6개의 이미지가 필요합니다",
        variant: "destructive",
      });
      return;
    }

    setIsConverting(true);
    try {
      const zip = new JSZip();

      // 각 이미지를 로블록스 이름으로 ZIP에 추가
      for (let i = 0; i < images.length; i++) {
        const base64Data = images[i].split(",")[1];
        zip.file(`${robloxNames[i]}.png`, base64Data, { base64: true });
      }

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, "roblox-skybox.zip");

      toast({
        title: "다운로드 완료",
        description: "로블록스 스카이박스가 ZIP 파일로 저장되었습니다",
      });
    } catch (error) {
      toast({
        title: "변환 실패",
        description: "파일 변환 중 오류가 발생했습니다",
        variant: "destructive",
      });
    } finally {
      setIsConverting(false);
    }
  };

  if (images.length === 0) {
    return null;
  }

  return (
    <div className="gradient-card p-8 rounded-xl shadow-elevation border border-border/50 space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">미리보기</h3>
        <p className="text-sm text-muted-foreground">
          스카이박스 6면이 준비되었습니다
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {images.map((img, idx) => (
          <div key={idx} className="space-y-2">
            <div className="aspect-square rounded-lg overflow-hidden border border-border/50 shadow-elevation">
              <img src={img} alt={faceNames[idx]} className="w-full h-full object-cover" />
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground capitalize">{faceNames[idx]}</p>
              <p className="text-xs text-primary font-mono">{robloxNames[idx]}</p>
            </div>
          </div>
        ))}
      </div>

      <Button
        onClick={convertAndDownload}
        disabled={isConverting}
        className="w-full h-12 gradient-primary hover:opacity-90 transition-all shadow-glow text-lg font-semibold"
      >
        {isConverting ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            변환 중...
          </>
        ) : (
          <>
            <Download className="mr-2 h-5 w-5" />
            로블록스 ZIP 다운로드
          </>
        )}
      </Button>
    </div>
  );
};
