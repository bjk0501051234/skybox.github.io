import { useState } from "react";
import { Upload, CheckCircle2, ImagePlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface DragDropUploaderProps {
  onImagesUploaded: (images: string[]) => void;
}

const faceLabels = [
  { key: "up", label: "위 (Up)", icon: "↑" },
  { key: "dn", label: "아래 (Down)", icon: "↓" },
  { key: "ft", label: "앞 (Front)", icon: "⊙" },
  { key: "bk", label: "뒤 (Back)", icon: "◉" },
  { key: "lf", label: "왼쪽 (Left)", icon: "←" },
  { key: "rt", label: "오른쪽 (Right)", icon: "→" },
];

export const DragDropUploader = ({ onImagesUploaded }: DragDropUploaderProps) => {
  const [images, setImages] = useState<{ [key: string]: string }>({});
  const [dragOver, setDragOver] = useState<string | null>(null);
  const { toast } = useToast();

  const resizeImageTo512 = (imageDataUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        ctx.drawImage(img, 0, 0, 512, 512);
        resolve(canvas.toDataURL('image/png'));
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageDataUrl;
    });
  };

  const handleFileInput = async (file: File, faceKey: string) => {
    if (!file.type.startsWith('image/')) {
      toast({
        title: "이미지 파일만 가능합니다",
        description: "PNG, JPG 형식의 이미지를 업로드해주세요",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const result = e.target?.result as string;
      try {
        const resizedImage = await resizeImageTo512(result);
        const newImages = { ...images, [faceKey]: resizedImage };
        setImages(newImages);
        
        if (Object.keys(newImages).length === 6) {
          const orderedImages = faceLabels.map(face => newImages[face.key]);
          onImagesUploaded(orderedImages);
          toast({
            title: "완료!",
            description: "6개의 면이 모두 업로드되었습니다",
          });
        }
      } catch (error) {
        toast({
          title: "처리 실패",
          description: "이미지 처리 중 오류가 발생했습니다",
          variant: "destructive",
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent, faceKey: string) => {
    e.preventDefault();
    setDragOver(null);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileInput(file, faceKey);
    }
  };

  const handleDragOver = (e: React.DragEvent, faceKey: string) => {
    e.preventDefault();
    setDragOver(faceKey);
  };

  const handleDragLeave = () => {
    setDragOver(null);
  };

  const handleClick = (faceKey: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpg,image/jpeg';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        handleFileInput(file, faceKey);
      }
    };
    input.click();
  };

  const handleReset = () => {
    setImages({});
    onImagesUploaded([]);
    toast({
      title: "초기화 완료",
      description: "모든 이미지가 제거되었습니다",
    });
  };

  const completedCount = Object.keys(images).length;
  const progress = (completedCount / 6) * 100;

  return (
    <div className="gradient-card p-8 rounded-xl shadow-elevation border border-border/50 space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <ImagePlus className="h-5 w-5 text-primary" />
            드래그 앤 드롭 업로드
          </h3>
          {completedCount > 0 && (
            <button
              onClick={handleReset}
              className="text-xs text-destructive hover:underline"
            >
              초기화
            </button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          각 면에 이미지를 드래그하거나 클릭해서 업로드하세요
        </p>
        
        {/* Progress Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{completedCount}/6 완료</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-2 bg-background/50 rounded-full overflow-hidden">
            <div 
              className="h-full gradient-primary transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {faceLabels.map((face) => {
          const hasImage = !!images[face.key];
          const isDragging = dragOver === face.key;

          return (
            <div
              key={face.key}
              onClick={() => !hasImage && handleClick(face.key)}
              onDrop={(e) => handleDrop(e, face.key)}
              onDragOver={(e) => handleDragOver(e, face.key)}
              onDragLeave={handleDragLeave}
              className={cn(
                "relative aspect-square rounded-lg border-2 border-dashed transition-all cursor-pointer group",
                isDragging && "border-primary bg-primary/10 scale-105",
                hasImage && "border-solid border-primary/50",
                !hasImage && !isDragging && "border-border/50 hover:border-primary/50 hover:bg-primary/5"
              )}
            >
              {hasImage ? (
                <>
                  <img 
                    src={images[face.key]} 
                    alt={face.label}
                    className="w-full h-full object-cover rounded-lg"
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClick(face.key);
                      }}
                      className="px-4 py-2 bg-primary/80 text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary transition-colors"
                    >
                      변경
                    </button>
                  </div>
                  <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
                  <div className="text-4xl">{face.icon}</div>
                  <Upload className={cn(
                    "h-6 w-6 transition-colors",
                    isDragging ? "text-primary" : "text-muted-foreground"
                  )} />
                  <div className="text-center">
                    <p className="text-xs font-semibold text-foreground">{face.label}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      드롭 또는 클릭
                    </p>
                  </div>
                </div>
              )}
              
              <div className="absolute bottom-2 left-2 right-2 bg-background/90 backdrop-blur-sm rounded px-2 py-1">
                <p className="text-xs text-center font-mono text-primary">
                  sky512_{face.key}.tex
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
