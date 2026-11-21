import { BLEED_MM, PX_PER_MM, STAMP_H_MM, STAMP_W_MM } from './layout';

/**
 * `cx`·`cy`: 우표 중심에 오는 원본 이미지 위의 점 (0~1 정규화).
 * `zoom`: 기본 배율 대비 배수 (≥ 1).
 */
export interface Crop {
  mode: 'fill' | 'fit';
  cx: number;
  cy: number;
  zoom: number;
}

export const DEFAULT_CROP: Crop = { mode: 'fill', cx: 0.5, cy: 0.5, zoom: 1 };

export interface RectMm {
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

/** 세로 우표 좌표계에서 칼선을 사방 BLEED_MM 키운 사각형 */
export const BLEED_RECT: RectMm = {
  xMm: -BLEED_MM,
  yMm: -BLEED_MM,
  wMm: STAMP_W_MM + 2 * BLEED_MM,
  hMm: STAMP_H_MM + 2 * BLEED_MM,
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** 출력 밀도가 이 값(px/mm)보다 낮으면 흐리게 나온다 */
const LOW_RES_PX_PER_MM = PX_PER_MM * 0.75;

/** 원본 1px당 mm */
function mmPerPx(imgW: number, imgH: number, crop: Crop): number {
  const base =
    crop.mode === 'fill'
      ? Math.max(BLEED_RECT.wMm / imgW, BLEED_RECT.hMm / imgH)
      : Math.min(STAMP_W_MM / imgW, STAMP_H_MM / imgH);
  return base * crop.zoom;
}

/** 세로 우표 좌표계에서 이미지 전체가 그려질 사각형 */
export function placeImage(imgW: number, imgH: number, crop: Crop): RectMm {
  const s = mmPerPx(imgW, imgH, crop);
  const wMm = imgW * s;
  const hMm = imgH * s;
  return {
    xMm: STAMP_W_MM / 2 - crop.cx * wMm,
    yMm: STAMP_H_MM / 2 - crop.cy * hMm,
    wMm,
    hMm,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampCrop(imgW: number, imgH: number, crop: Crop): Crop {
  const zoom = clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM);
  if (crop.mode === 'fit') {
    return { mode: 'fit', cx: clamp(crop.cx, 0, 1), cy: clamp(crop.cy, 0, 1), zoom };
  }
  // 번짐 사각형의 가장자리가 이미지 밖으로 나가지 않도록 중심을 제한한다.
  const { wMm, hMm } = placeImage(imgW, imgH, { ...crop, zoom });
  const marginX = BLEED_RECT.wMm / 2 / wMm;
  const marginY = BLEED_RECT.hMm / 2 / hMm;
  return {
    mode: 'fill',
    cx: clamp(crop.cx, marginX, 1 - marginX),
    cy: clamp(crop.cy, marginY, 1 - marginY),
    zoom,
  };
}

export function isLowRes(imgW: number, imgH: number, crop: Crop): boolean {
  return 1 / mmPerPx(imgW, imgH, crop) < LOW_RES_PX_PER_MM;
}
