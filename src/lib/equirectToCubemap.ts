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

export function createLocalSkyPanorama(prompt: string, width = 2048, height = 1024): string {
  const lower = prompt.toLowerCase();
  const rnd = seededRandom(prompt || "skybox");
  const night = /night|밤|별|달|aurora|오로라|space|우주/.test(lower);
  const sunset = /sunset|sunrise|노을|석양|일출|분홍|orange|pink/.test(lower);
  const storm = /storm|thunder|폭풍|먹구름|회색|gray|grey/.test(lower);
  const aurora = /aurora|오로라|북극광|green|초록|보라|purple/.test(lower);

  const zenith: Rgb = night ? [11, 18, 44] : storm ? [78, 89, 104] : sunset ? [65, 102, 178] : [57, 132, 219];
  const horizon: Rgb = night ? [32, 45, 86] : storm ? [154, 165, 172] : sunset ? [255, 153, 109] : [186, 225, 255];
  const nadir: Rgb = night ? [6, 10, 28] : storm ? [99, 109, 118] : sunset ? [92, 66, 114] : [119, 181, 229];

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, rgba(zenith));
  gradient.addColorStop(0.48, rgba(horizon));
  gradient.addColorStop(0.58, rgba(horizon));
  gradient.addColorStop(1, rgba(nadir));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.globalCompositeOperation = "screen";
  for (let band = 0; band < 4; band++) {
    const y = height * (0.28 + rnd() * 0.34);
    const hue = aurora ? (rnd() > 0.5 ? [96, 255, 185] : [171, 111, 255]) : mix(horizon, [255, 255, 255], 0.35);
    const line = ctx.createLinearGradient(0, y - 180, 0, y + 180);
    line.addColorStop(0, rgba(hue as Rgb, 0));
    line.addColorStop(0.5, rgba(hue as Rgb, aurora ? 0.28 : 0.12));
    line.addColorStop(1, rgba(hue as Rgb, 0));
    ctx.fillStyle = line;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= width; x += 80) {
      ctx.lineTo(x, y + Math.sin(x * 0.006 + band * 2.3) * (24 + rnd() * 28));
    }
    ctx.lineTo(width, y + 260);
    ctx.lineTo(0, y + 260);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  if (night) {
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    for (let i = 0; i < 260; i++) {
      const x = rnd() * width;
      const y = rnd() * height * 0.48;
      const r = 0.55 + rnd() * 1.25;
      ctx.globalAlpha = 0.3 + rnd() * 0.7;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (!/no cloud|구름없|구름 없이/.test(lower)) {
    ctx.globalAlpha = night ? 0.18 : 0.32;
    for (let i = 0; i < 18; i++) {
      const x = rnd() * width;
      const y = height * (0.34 + rnd() * 0.22);
      const w = width * (0.08 + rnd() * 0.12);
      const h = height * (0.018 + rnd() * 0.035);
      const cloud = ctx.createRadialGradient(x, y, 0, x, y, w);
      cloud.addColorStop(0, "rgba(255,255,255,0.75)");
      cloud.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = cloud;
      ctx.beginPath();
      ctx.ellipse(x, y, w, h, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  return canvas.toDataURL("image/png");
}
