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
    // decode()는 화면이 그려지지 않는 동안(백그라운드 탭 등) 끝나지 않을 수 있어 load 이벤트를 기다린다
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('이미지를 열 수 없어요'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 올린 사진의 긴 변 최대 길이. 확대 5배 정도까지 출력 밀도가 충분하고, 폰 메모리를 크게 아낀다 */
export const MAX_UPLOAD_EDGE = 2400;

export function uploadSize(width: number, height: number): { width: number; height: number; scaled: boolean } {
  const long = Math.max(width, height);
  if (long <= MAX_UPLOAD_EDGE) return { width, height, scaled: false };
  const k = MAX_UPLOAD_EDGE / long;
  return { width: Math.round(width * k), height: Math.round(height * k), scaled: true };
}

/**
 * 저장하기 전에 사진을 열어 본다(열 수 없으면 throw). 너무 크면 긴 변을 MAX_UPLOAD_EDGE로 줄인 JPEG로 바꾼다.
 */
export async function prepareUpload(file: Blob): Promise<Blob> {
  const img = await loadImage(file);
  const size = uploadSize(img.naturalWidth || img.width, img.naturalHeight || img.height);
  if (!size.scaled) return file;
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들 수 없어요');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('사진을 줄이지 못했어요'))), 'image/jpeg', 0.92);
  });
}
