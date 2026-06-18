import { useState } from "react";
import { Link } from "react-router-dom";
import { SkyboxGenerator } from "@/components/SkyboxGenerator";
import { DragDropUploader } from "@/components/DragDropUploader";
import { CubePreview3D } from "@/components/CubePreview3D";
import { SkyboxPreview } from "@/components/SkyboxPreview";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Box, Info, Key, LogIn, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const Index = () => {
  const [skyboxImages, setSkyboxImages] = useState<string[]>([]);
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen py-12 px-4">
      <div className="max-w-7xl mx-auto space-y-12">
        {/* Top bar */}
        <div className="flex justify-end gap-2">
          {user ? (
            <>
              <Link to="/settings"><Button variant="outline" size="sm"><Key className="h-4 w-4 mr-1" /> AI 키 설정</Button></Link>
              <Button variant="ghost" size="sm" onClick={() => signOut()}><LogOut className="h-4 w-4 mr-1" /> 로그아웃</Button>
            </>
          ) : (
            <Link to="/auth"><Button variant="outline" size="sm"><LogIn className="h-4 w-4 mr-1" /> 로그인</Button></Link>
          )}
        </div>

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
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <DragDropUploader onImagesUploaded={setSkyboxImages} />
            
            <div className="flex items-center gap-4">
              <Separator className="flex-1" />
              <span className="text-sm text-muted-foreground font-semibold">또는 AI 생성</span>
              <Separator className="flex-1" />
            </div>
            
            <SkyboxGenerator onGenerated={setSkyboxImages} />
            
            <SkyboxPreview images={skyboxImages} />
          </div>

          <div className="space-y-8">
            <CubePreview3D images={skyboxImages} />
            
            {/* Info Card */}
            <div className="gradient-card p-6 rounded-xl border border-border/50 space-y-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="space-y-2 text-sm">
                  <p className="text-foreground font-semibold">사용 방법</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>• 각 면에 이미지를 드래그하여 업로드</li>
                    <li>• 자동으로 512x512 크기로 변환</li>
                    <li>• 3D로 실시간 프리뷰 확인</li>
                    <li>• .tex 형식으로 다운로드</li>
                  </ul>
                </div>
              </div>
            </div>
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
