import { type Affine, scale } from './affine';

/** 레이아웃 수치는 이 파일 한 곳에만 정의한다. */

/** 코닥 미니 3 레트로 인화지 한 변 (3인치) */
export const PAPER_MM = 76.2;
/** 출력 이미지 한 변 (300dpi) */
export const SHEET_PX = 900;
export const PX_PER_MM = SHEET_PX / PAPER_MM;

/** 우표 펀칭기 칼선 (세로 우표 기준) */
export const STAMP_W_MM = 31.7;
export const STAMP_H_MM = 38.1;
/** 칼선 바깥 사방으로 더 그리는 여유 */
export const BLEED_MM = 1;

/** 칼선 기준, 종이 좌표(mm). 원점은 인화지 왼쪽 위. */
export interface Slot {
  index: 0 | 1 | 2;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  rotated: boolean;
}

const GAP_X_MM = (PAPER_MM - 2 * STAMP_W_MM) / 3;
const GAP_Y_MM = (PAPER_MM - STAMP_H_MM - STAMP_W_MM) / 3;

/** 칸1·칸2 세로(위), 칸3 가로(아래, 가운데 정렬) */
export const SLOTS: readonly Slot[] = [
  { index: 0, xMm: GAP_X_MM, yMm: GAP_Y_MM, wMm: STAMP_W_MM, hMm: STAMP_H_MM, rotated: false },
  { index: 1, xMm: 2 * GAP_X_MM + STAMP_W_MM, yMm: GAP_Y_MM, wMm: STAMP_W_MM, hMm: STAMP_H_MM, rotated: false },
  {
    index: 2,
    xMm: (PAPER_MM - STAMP_H_MM) / 2,
    yMm: 2 * GAP_Y_MM + STAMP_H_MM,
    wMm: STAMP_H_MM,
    hMm: STAMP_W_MM,
    rotated: true,
  },
];

/**
 * 세로 우표 좌표계(원점 = 세로 칼선 왼쪽 위, mm)를 종이 mm 좌표로 옮긴다.
 * `rotated`이면 시계 방향 90°로 돌려, 세로 우표의 왼쪽 위가 가로 칸의 오른쪽 위에 온다.
 */
export function slotTransform(slot: Slot): Affine {
  if (!slot.rotated) return [1, 0, 0, 1, slot.xMm, slot.yMm];
  // (x, y) → (slot.x + slot.w − y, slot.y + x)
  return [0, 1, -1, 0, slot.xMm + slot.wMm, slot.yMm];
}

/** 종이 mm → 시트 px */
export const PX_TRANSFORM: Affine = scale(PX_PER_MM);
