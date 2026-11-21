/**
 * URL 또는 Blob을 디코딩된 이미지로 만든다.
 * URL은 fetch로 Blob을 받아 objectURL로 디코딩하므로, 캔버스에 그려도 오염(tainted)되지 않는다.
 */
export async function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  let blob: Blob;
  if (typeof src === 'string') {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`이미지를 받을 수 없어요 (HTTP ${res.status})`);
    blob = await res.blob();
  } else {
    blob = src;
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
