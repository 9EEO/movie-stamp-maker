import { apply, compose, scale, translate, IDENTITY } from '../../src/core/affine';
import {
  BLEED_MM,
  PAPER_MM,
  PX_PER_MM,
  PX_TRANSFORM,
  SHEET_PX,
  SLOTS,
  STAMP_H_MM,
  STAMP_W_MM,
  slotTransform,
} from '../../src/core/layout';

const closeTo = (n: number) => expect.closeTo(n, 3);

test('paper and stamp constants', () => {
  expect(PAPER_MM).toBe(76.2);
  expect(SHEET_PX).toBe(900);
  expect(PX_PER_MM).toBe(900 / 76.2);
  expect(STAMP_W_MM).toBe(31.7);
  expect(STAMP_H_MM).toBe(38.1);
  expect(BLEED_MM).toBe(1);
});

test('SLOTS match design coordinates', () => {
  expect(SLOTS).toHaveLength(3);
  expect(SLOTS[0]).toMatchObject({ index: 0, xMm: closeTo(4.267), yMm: closeTo(2.133), wMm: 31.7, hMm: 38.1, rotated: false });
  expect(SLOTS[1]).toMatchObject({ index: 1, xMm: closeTo(40.233), yMm: closeTo(2.133), wMm: 31.7, hMm: 38.1, rotated: false });
  expect(SLOTS[2]).toMatchObject({ index: 2, xMm: closeTo(19.05), yMm: closeTo(42.367), wMm: 38.1, hMm: 31.7, rotated: true });
});

test('bleed rects never overlap and stay on paper', () => {
  const rects = SLOTS.map((s) => ({
    x0: s.xMm - BLEED_MM,
    y0: s.yMm - BLEED_MM,
    x1: s.xMm + s.wMm + BLEED_MM,
    y1: s.yMm + s.hMm + BLEED_MM,
  }));
  for (const r of rects) {
    expect(r.x0).toBeGreaterThanOrEqual(0);
    expect(r.y0).toBeGreaterThanOrEqual(0);
    expect(r.x1).toBeLessThanOrEqual(PAPER_MM);
    expect(r.y1).toBeLessThanOrEqual(PAPER_MM);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
      expect(overlap, `slots ${i} and ${j} overlap`).toBe(false);
    }
  }
});

test('slotTransform maps portrait corners', () => {
  expect(apply(slotTransform(SLOTS[0]), 0, 0)).toEqual([closeTo(4.267), closeTo(2.133)]);
  expect(apply(slotTransform(SLOTS[1]), 31.7, 38.1)).toEqual([closeTo(71.933), closeTo(40.233)]);
  // 칸3 (시계 방향 90°): 세로 왼쪽 위 → 가로 칸 오른쪽 위, 세로 오른쪽 위 → 가로 칸 오른쪽 아래
  expect(apply(slotTransform(SLOTS[2]), 0, 0)).toEqual([closeTo(57.15), closeTo(42.367)]);
  expect(apply(slotTransform(SLOTS[2]), 31.7, 0)).toEqual([closeTo(57.15), closeTo(74.067)]);
  expect(apply(slotTransform(SLOTS[2]), 0, 38.1)).toEqual([closeTo(19.05), closeTo(42.367)]);
});

test('affine compose applies inner first', () => {
  const m = compose(scale(2), translate(3, 4));
  expect(apply(m, 1, 1)).toEqual([8, 10]);
  expect(apply(IDENTITY, 5, 6)).toEqual([5, 6]);
});

test('PX_TRANSFORM maps paper mm to sheet px', () => {
  expect(apply(PX_TRANSFORM, PAPER_MM, PAPER_MM)).toEqual([closeTo(900), closeTo(900)]);
});
