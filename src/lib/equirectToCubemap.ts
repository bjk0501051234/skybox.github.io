// Convert an equirectangular (2:1) panorama image into 6 cubemap faces.
// Output face order: [top, bottom, front, back, left, right] — matches the rest of the app.
// Faces are sampled with bilinear interpolation so seams are continuous by construction
// (every face is derived from the SAME panorama, like cutting a cross out of a sheet of paper).

export type FaceName = "top" | "bottom" | "front" | "back" | "left" | "right";
export const FACE_ORDER: FaceName[] = ["top", "bottom", "front", "back", "left", "right"];

type Rgb = [number, number, number];

function seededRandom(seedText: string) {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6D2B79F5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function rgba([r, g, b]: Rgb, alpha = 1) {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function sampleBilinear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  u: number, // 0..w (wraps horizontally)
  v: number, // 0..h (clamped vertically)
): [number, number, number] {
  // wrap u
  let uu = u % w;
  if (uu < 0) uu += w;
  const vv = Math.max(0, Math.min(h - 1.0001, v));
  const x0 = Math.floor(uu);
  const y0 = Math.floor(vv);
  const x1 = (x0 + 1) % w;
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = uu - x0;
  const fy = vv - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  return [
    data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11,
    data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11,
    data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11,
  ];
}

function faceDirection(face: FaceName, a: number, b: number): [number, number, number] {
  // a,b ∈ [-1, 1]; coordinate system: +X right, +Y up, +Z toward viewer (inside cube).
  switch (face) {
    case "front":  return [a, -b, 1];
    case "back":   return [-a, -b, -1];
    case "left":   return [-1, -b, a];
    case "right":  return [1, -b, -a];
    case "top":    return [a, 1, b];
    case "bottom": return [a, -1, -b];
  }
}

export async function panoramaToCubemap(panoramaDataUrl: string, faceSize = 1024): Promise<Record<FaceName, string>> {
  const img = await loadImage(panoramaDataUrl);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true })!;
  srcCtx.drawImage(img, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

  const result = {} as Record<FaceName, string>;

  for (const face of FACE_ORDER) {
    const out = document.createElement("canvas");
    out.width = faceSize;
    out.height = faceSize;
    const outCtx = out.getContext("2d")!;
    const outImg = outCtx.createImageData(faceSize, faceSize);

    for (let y = 0; y < faceSize; y++) {
      for (let x = 0; x < faceSize; x++) {
        const a = (2 * (x + 0.5)) / faceSize - 1;
        const b = (2 * (y + 0.5)) / faceSize - 1;
        const [vx, vy, vz] = faceDirection(face, a, b);
        const r = Math.hypot(vx, vy, vz);
        const lon = Math.atan2(vx, vz); // -π..π
        const lat = Math.asin(vy / r);  // -π/2..π/2
        const u = (lon / (2 * Math.PI) + 0.5) * srcW;
        const v = (0.5 - lat / Math.PI) * srcH;
        const [R, G, B] = sampleBilinear(srcData, srcW, srcH, u, v);
        const di = (y * faceSize + x) * 4;
        outImg.data[di] = R;
        outImg.data[di + 1] = G;
        outImg.data[di + 2] = B;
        outImg.data[di + 3] = 255;
      }
    }
    outCtx.putImageData(outImg, 0, 0);
    result[face] = out.toDataURL("image/png");
  }

  return result;
}
