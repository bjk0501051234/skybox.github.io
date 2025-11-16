import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ImageUploaderProps {
  onImagesUploaded: (images: string[]) => void;
}

export const ImageUploader = ({ onImagesUploaded }: ImageUploaderProps) => {
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    if (files.length !== 6) {
      toast({
        title: "6개의 이미지를 선택하세요",
        description: "스카이박스는 정확히 6면이 필요합니다",
        variant: "destructive",
      });
      return;
    }

    const imagePromises = Array.from(files).map((file) => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
      });
    });

    Promise.all(imagePromises).then((images) => {
      setUploadedImages(images);
      onImagesUploaded(images);
      toast({
        title: "업로드 완료",
        description: "6개의 이미지가 업로드되었습니다",
      });
    });
  };

  const handleRemove = () => {
    setUploadedImages([]);
    onImagesUploaded([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="gradient-card p-8 rounded-xl shadow-elevation border border-border/50">
      <div className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            이미지 업로드
          </h3>
          <p className="text-sm text-muted-foreground">
            PNG 형식의 6면 이미지를 업로드하세요
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

        {uploadedImages.length === 0 ? (
          <Button
            onClick={() => fileInputRef.current?.click()}
            variant="outline"
            className="w-full h-32 border-2 border-dashed border-border/50 hover:border-primary hover:bg-primary/5 transition-all"
          >
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">6개의 PNG 파일 선택</span>
            </div>
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {uploadedImages.map((img, idx) => (
                <div key={idx} className="aspect-square rounded-lg overflow-hidden border border-border/50">
                  <img src={img} alt={`Face ${idx + 1}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
            <Button
              onClick={handleRemove}
              variant="outline"
              className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
            >
              <X className="mr-2 h-4 w-4" />
              이미지 제거
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
