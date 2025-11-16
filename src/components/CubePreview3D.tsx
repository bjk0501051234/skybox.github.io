import { useRef, useMemo } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { Box } from "lucide-react";

interface CubePreview3DProps {
  images: string[];
}

const RotatingCube = ({ textures }: { textures: THREE.Texture[] }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      // 자동 회전
      meshRef.current.rotation.y = state.clock.getElapsedTime() * 0.2;
      meshRef.current.rotation.x = Math.sin(state.clock.getElapsedTime() * 0.3) * 0.1;
    }
  });

  // 각 면에 다른 텍스처를 적용하는 재질 배열
  const materials = useMemo(() => {
    if (textures.length !== 6) {
      return Array(6).fill(new THREE.MeshStandardMaterial({ color: 0x333333 }));
    }

    // 텍스처 순서: right, left, top, bottom, front, back (Three.js 큐브 면 순서)
    // 우리 순서: up(0), down(1), front(2), back(3), left(4), right(5)
    // Three.js 순서로 재배열: right(5), left(4), top(0), bottom(1), front(2), back(3)
    const orderedTextures = [
      textures[5], // right
      textures[4], // left
      textures[0], // top
      textures[1], // bottom
      textures[2], // front
      textures[3], // back
    ];

    return orderedTextures.map(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshStandardMaterial({ map: texture });
    });
  }, [textures]);

  return (
    <mesh ref={meshRef} material={materials}>
      <boxGeometry args={[2, 2, 2]} />
    </mesh>
  );
};

const Scene = ({ images }: { images: string[] }) => {
  // 이미지를 Three.js 텍스처로 변환
  const textures = useMemo(() => {
    if (images.length !== 6) return [];
    
    return images.map(imageUrl => {
      const texture = new THREE.TextureLoader().load(imageUrl);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    });
  }, [images]);

  if (textures.length === 0) {
    return (
      <mesh>
        <boxGeometry args={[2, 2, 2]} />
        <meshStandardMaterial color="#1a1a1a" wireframe />
      </mesh>
    );
  }

  return <RotatingCube textures={textures} />;
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
              이미지를 업로드하면<br />3D 큐브로 확인할 수 있습니다
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
          3D 프리뷰
        </h3>
        <p className="text-sm text-muted-foreground">
          마우스로 드래그하여 회전, 휠로 줌 조정
        </p>
      </div>

      <div className="aspect-square bg-background/50 rounded-lg overflow-hidden border border-border/30">
        <Canvas>
          <PerspectiveCamera makeDefault position={[0, 0, 5]} />
          <OrbitControls 
            enableDamping
            dampingFactor={0.05}
            rotateSpeed={0.5}
            minDistance={3}
            maxDistance={10}
          />
          
          {/* Lighting */}
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          <directionalLight position={[-10, -10, -5]} intensity={0.3} />
          
          {/* Scene */}
          <Scene images={images} />
          
          {/* Background */}
          <color attach="background" args={["#0a0a0a"]} />
        </Canvas>
      </div>

      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-primary/50 rounded" />
          <span>드래그: 회전</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-primary/50 rounded" />
          <span>휠: 줌</span>
        </div>
      </div>
    </div>
  );
};
