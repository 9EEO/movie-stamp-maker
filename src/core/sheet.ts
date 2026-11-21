import { type Affine, IDENTITY, compose } from './affine';
import { type Calibration, calibrationAffine } from './calibration';
import { BLEED_RECT, type Crop, placeImage } from './crop';
import { PAPER_MM, PX_TRANSFORM, SHEET_PX, SLOTS, STAMP_H_MM, STAMP_W_MM, type Slot, slotTransform } from './layout';

export function chunkIntoSheets<T>(items: T[]): T[][] {
  const sheets: T[][] = [];
  for (let i = 0; i < items.length; i += SLOTS.length) sheets.push(items.slice(i, i + SLOTS.length));
  return sheets;
}

export interface SheetEntry {
  image: CanvasImageSource & { width: number; height: number };
  crop: Crop;
}

/** 세로 우표 좌표계(mm) → 시트 px */
export function slotMatrix(slot: Slot, cal: Calibration): Affine {
  return compose(PX_TRANSFORM, compose(calibrationAffine(cal), slotTransform(slot)));
}

/** 종이 좌표계(mm) → 시트 px */
function paperMatrix(cal: Calibration): Affine {
  return compose(PX_TRANSFORM, calibrationAffine(cal));
}

function fillWhite(ctx: CanvasRenderingContext2D) {
  ctx.setTransform(...IDENTITY);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SHEET_PX, SHEET_PX);
}

export function paintSheet(ctx: CanvasRenderingContext2D, entries: (SheetEntry | null)[], cal: Calibration): void {
  fillWhite(ctx);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  SLOTS.forEach((slot, i) => {
    const entry = entries[i];
    if (!entry) return;
    const { xMm, yMm, wMm, hMm } = BLEED_RECT;
    ctx.save();
    ctx.setTransform(...slotMatrix(slot, cal));
    ctx.beginPath();
    ctx.rect(xMm, yMm, wMm, hMm);
    ctx.clip();
    // 전체 보이기 모드에서 남는 부분은 흰색
    ctx.fillStyle = '#fff';
    ctx.fillRect(xMm, yMm, wMm, hMm);
    const r = placeImage(entry.image.width, entry.image.height, entry.crop);
    ctx.drawImage(entry.image, r.xMm, r.yMm, r.wMm, r.hMm);
    ctx.restore();
  });
}

const RULER_MM = 50;
const LINE_MM = 0.2;
const EDGE_INSET_MM = 2;
const CROSS_MM = 4;

/** 가로 눈금자. 기준선은 y = 0이고 눈금은 위쪽(-y)으로 그린다. */
function drawRuler(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(RULER_MM, 0);
  for (let mm = 0; mm <= RULER_MM; mm++) {
    const len = mm % 10 === 0 ? 3 : mm % 5 === 0 ? 2 : 1;
    ctx.moveTo(mm, 0);
    ctx.lineTo(mm, -len);
  }
  ctx.stroke();
  for (let mm = 0; mm <= RULER_MM; mm += 10) ctx.fillText(String(mm), mm, -3.3);
}

/**
 * 보정용 테스트 시트: 칸별 칼선 외곽선과 중심 십자, 가로·세로 50mm 눈금자,
 * 종이 가장자리에서 2mm 안쪽 선. 보정값을 적용해 그린다.
 */
export function paintTestSheet(ctx: CanvasRenderingContext2D, cal: Calibration): void {
  fillWhite(ctx);
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineWidth = LINE_MM;

  for (const slot of SLOTS) {
    ctx.save();
    ctx.setTransform(...slotMatrix(slot, cal));
    ctx.strokeRect(0, 0, STAMP_W_MM, STAMP_H_MM);
    const cx = STAMP_W_MM / 2;
    const cy = STAMP_H_MM / 2;
    ctx.beginPath();
    ctx.moveTo(cx - CROSS_MM / 2, cy);
    ctx.lineTo(cx + CROSS_MM / 2, cy);
    ctx.moveTo(cx, cy - CROSS_MM / 2);
    ctx.lineTo(cx, cy + CROSS_MM / 2);
    ctx.stroke();
    ctx.restore();
  }

  const paper = paperMatrix(cal);
  ctx.save();
  ctx.setTransform(...paper);
  ctx.strokeRect(EDGE_INSET_MM, EDGE_INSET_MM, PAPER_MM - 2 * EDGE_INSET_MM, PAPER_MM - 2 * EDGE_INSET_MM);
  ctx.restore();

  ctx.font = '2px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const start = (PAPER_MM - RULER_MM) / 2;
  const top = SLOTS[0];
  const bottom = SLOTS[2];
  // 가로 눈금자: 위 두 칸과 아래 칸 사이 틈의 가운데
  const gapY = (top.yMm + top.hMm + bottom.yMm) / 2;
  ctx.save();
  ctx.setTransform(...compose(paper, [1, 0, 0, 1, start, gapY]));
  drawRuler(ctx);
  ctx.restore();
  // 세로 눈금자: 위 두 칸 사이 틈의 가운데, 위에서 아래로
  const gapX = PAPER_MM / 2;
  ctx.save();
  ctx.setTransform(...compose(paper, [0, 1, -1, 0, gapX, start]));
  drawRuler(ctx);
  ctx.restore();
}

/** 900×900 캔버스에 그린 뒤 PNG Blob을 반환한다. */
export function renderToBlob(paint: (ctx: CanvasRenderingContext2D) => void): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_PX;
  canvas.height = SHEET_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('캔버스를 만들 수 없어요'));
  paint(ctx);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('이미지를 만들 수 없어요'))), 'image/png');
  });
}
