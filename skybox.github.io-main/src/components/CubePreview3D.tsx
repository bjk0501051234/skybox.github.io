import { useMemo } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { Box } from "lucide-react";

interface CubePreview3DProps {
  images: string[];
}

const SkyboxInside = ({ images }: { images: string[] }) => {
  const textures = useMemo(() => {
    return images.map((url) => {
      const t = new THREE.TextureLoader().load(url);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
  }, [images]);

  // Our order: up(0), down(1), front(2), back(3), left(4), right(5)
  // Three.js BoxGeometry face order: +X(right), -X(left), +Y(top), -Y(bottom), +Z(front), -Z(back)
  // When viewed from inside with scale.x = -1 (flipped), we need to swap left/right textures
  // so that what the user labeled "left" actually appears on the viewer's left.
  const materials = useMemo(() => {
    if (textures.length !== 6) return [];
    const ordered = [
      textures[4], // +X slot -> show "left" image (because x is flipped inside)
      textures[5], // -X slot -> show "right" image
      textures[0], // +Y top
      textures[1], // -Y bottom
      textures[2], // +Z front
      textures[3], // -Z back
    ];
    return ordered.map(
      (tex) =>
        new THREE.MeshBasicMaterial({
          map: tex,
          side: THREE.BackSide,
        })
    );
  }, [textures]);

  if (materials.length === 0) return null;

  return (
    <mesh scale={[-1, 1, 1]} material={materials}>
      <boxGeometry args={[100, 100, 100]} />
    </mesh>
  );
};

export const CubePreview3D = ({ images }: CubePreview3DProps) => {
  if (images.length === 0) {
    return (
      <div className="gradient-card p-8 rounded-xl shadow-elevation border border-border/50">
        <div className="aspect-square bg-background/50 rounded-lg flex flex-col items-center justify-center gap-4 border border-border/30">
          <Box className="h-16 w-16 text-muted-foreground animate-float" />
          <div className="text-center">
            <p className="text-lg font-semibold text-foreground">3D 프리뷰</p>
            <p className="text-sm text-muted-foreground mt-2">
              이미지를 업로드하면<br />게임 안에서 보는 것처럼 확인할 수 있습니다
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="gradient-card p-8 rounded-xl shadow-elevation border border-border/50 space-y-4">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Box className="h-5 w-5 text-primary" />
          3D 프리뷰 (게임 내부 시점)
        </h3>
        <p className="text-sm text-muted-foreground">
          드래그하여 둘러보기, 휠로 시야각(줌) 조정
        </p>
      </div>

      <div className="aspect-square bg-background/50 rounded-lg overflow-hidden border border-border/30">
        <Canvas>
          <PerspectiveCamera makeDefault position={[0, 0, 0.0001]} fov={75} />
          <OrbitControls
            enableDamping
            dampingFactor={0.08}
            rotateSpeed={-0.4}
            enableZoom={true}
            enablePan={false}
            minDistance={0.0001}
            maxDistance={0.0001}
          />
          <SkyboxInside images={images} />
        </Canvas>
      </div>

      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-primary/50 rounded" />
          <span>드래그: 둘러보기</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-primary/50 rounded" />
          <span>휠: 줌</span>
        </div>
      </div>
    </div>
  );
};
