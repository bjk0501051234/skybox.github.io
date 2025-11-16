/**
 * 이미지를 512x512 크기로 리사이즈
 */
export const resizeImageTo512 = (imageDataUrl: string): Promise<string> => {
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

      // 이미지를 512x512로 스케일링 (확대 또는 축소)
      ctx.drawImage(img, 0, 0, 512, 512);
      
      resolve(canvas.toDataURL('image/png'));
    };
    
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
};

/**
 * 여러 이미지를 512x512로 일괄 리사이즈
 */
export const resizeImagesTo512 = async (images: string[]): Promise<string[]> => {
  const resizedImages = await Promise.all(
    images.map(img => resizeImageTo512(img))
  );
  return resizedImages;
};

/**
 * Base64 이미지를 Blob으로 변환
 */
export const base64ToBlob = (base64: string): Blob => {
  const parts = base64.split(',');
  const contentType = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
  const raw = window.atob(parts[1]);
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);

  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }

  return new Blob([uInt8Array], { type: contentType });
};
