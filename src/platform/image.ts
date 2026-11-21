import type { Stamp } from '../data/db';
import { getBlob } from '../data/db';
import { posterUrl } from '../tmdb/client';

/** 캔버스에 그릴 수 있고 크기를 아는 이미지 */
export type ImageLike = CanvasImageSource & { width: number; height: number };

/** 출력용 원본 이미지: TMDB 포스터는 w780, 직접 올린 사진은 저장된 Blob */
export async function loadStampImage(stamp: Pick<Stamp, 'source' | 'posterPath' | 'blobId'>): Promise<ImageLike> {
  if (stamp.source === 'tmdb') {
    if (!stamp.posterPath) throw new Error('포스터가 없어요');
    return loadImage(posterUrl(stamp.posterPath, 'w780'));
  }
  const blob = stamp.blobId ? await getBlob(stamp.blobId) : undefined;
  if (!blob) throw new Error('사진을 찾을 수 없어요');
  return loadImage(blob);
}

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
