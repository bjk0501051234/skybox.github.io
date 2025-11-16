import { useState } from "react";
import { SkyboxGenerator } from "@/components/SkyboxGenerator";
import { ImageUploader } from "@/components/ImageUploader";
import { SkyboxPreview } from "@/components/SkyboxPreview";
import { Separator } from "@/components/ui/separator";
import { Box } from "lucide-react";

const Index = () => {
  const [skyboxImages, setSkyboxImages] = useState<string[]>([]);

  return (
    <div className="min-h-screen py-12 px-4">
      <div className="max-w-6xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center space-y-4 animate-float">
          <div className="flex items-center justify-center gap-3">
            <Box className="h-12 w-12 text-primary" />
            <h1 className="text-5xl font-bold bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              Skybox Studio
            </h1>
          </div>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            AI로 스카이박스를 생성하거나 이미지를 업로드하여 로블록스용 텍스처로 변환하세요
          </p>
        </div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-2 gap-8">
          <div className="space-y-8">
            <SkyboxGenerator onGenerated={setSkyboxImages} />
            
            <div className="flex items-center gap-4">
              <Separator className="flex-1" />
              <span className="text-sm text-muted-foreground font-semibold">또는</span>
              <Separator className="flex-1" />
            </div>
            
            <ImageUploader onImagesUploaded={setSkyboxImages} />
          </div>

          <div className="lg:sticky lg:top-8 h-fit">
            <SkyboxPreview images={skyboxImages} />
          </div>
        </div>

        {/* Footer Info */}
        <div className="gradient-card p-6 rounded-xl border border-border/50 text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            모든 이미지는 자동으로 512x512 크기로 변환되어 로블록스에서 바로 사용 가능합니다
          </p>
          <p className="text-xs text-muted-foreground">
            파일명: sky512_up.tex, sky512_dn.tex, sky512_ft.tex, sky512_bk.tex, sky512_lf.tex, sky512_rt.tex
          </p>
        </div>
      </div>
    </div>
  );
};

export default Index;
