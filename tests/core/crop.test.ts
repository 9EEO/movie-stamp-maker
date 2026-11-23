import { BLEED_RECT, DEFAULT_CROP, clampCrop, imagePointAt, isLowRes, placeImage, type Crop } from '../../src/core/crop';
import { STAMP_H_MM, STAMP_W_MM } from '../../src/core/layout';

const closeTo = (n: number) => expect.closeTo(n, 3);

// 경계에 딱 붙은 크롭은 부동소수점 오차(1e-14mm 수준)가 생길 수 있다.
const EPS = 1e-9;

function expectCoversBleed(imgW: number, imgH: number, crop: Crop) {
  const r = placeImage(imgW, imgH, crop);
  expect(r.xMm).toBeLessThanOrEqual(-1 + EPS);
  expect(r.yMm).toBeLessThanOrEqual(-1 + EPS);
  expect(r.xMm + r.wMm).toBeGreaterThanOrEqual(32.7 - EPS);
  expect(r.yMm + r.hMm).toBeGreaterThanOrEqual(39.1 - EPS);
}

test('BLEED_RECT is the cut line grown by 1mm on every side', () => {
  expect(BLEED_RECT).toEqual({ xMm: -1, yMm: -1, wMm: 33.7, hMm: 40.1 });
});

test('fill default on 1000x1500 poster covers bleed', () => {
  const r = placeImage(1000, 1500, DEFAULT_CROP);
  expect(r).toEqual({ xMm: closeTo(-1), yMm: closeTo(-6.225), wMm: closeTo(33.7), hMm: closeTo(50.55) });
});

test('fit shows whole poster inside cut line', () => {
  expect(placeImage(1000, 1500, { ...DEFAULT_CROP, mode: 'fit' })).toEqual({
    xMm: closeTo(3.15),
    yMm: closeTo(0),
    wMm: closeTo(25.4),
    hMm: closeTo(38.1),
  });
});

test('zoom scales around the chosen center', () => {
  const r = placeImage(1000, 1500, { mode: 'fill', cx: 0.5, cy: 0.5, zoom: 2 });
  expect(r.wMm).toBeCloseTo(67.4, 3);
  expect(r.xMm + r.wMm / 2).toBeCloseTo(15.85, 3);
  expect(r.yMm + r.hMm / 2).toBeCloseTo(19.05, 3);
});

test('clampCrop in fill mode keeps bleed covered', () => {
  const c = clampCrop(1000, 1500, { mode: 'fill', cx: 0, cy: 0, zoom: 0.5 });
  expect(c.zoom).toBe(1);
  expectCoversBleed(1000, 1500, c);
  expectCoversBleed(1000, 1500, clampCrop(1000, 1500, { mode: 'fill', cx: 1, cy: 1, zoom: 1 }));
  expectCoversBleed(1000, 1500, clampCrop(1000, 1500, { mode: 'fill', cx: -3, cy: 7, zoom: 3 }));
});

test('clampCrop handles very wide upload (4000x1000) in fill mode', () => {
  for (const crop of [
    { mode: 'fill' as const, cx: 0, cy: 0, zoom: 1 },
    { mode: 'fill' as const, cx: 1, cy: 1, zoom: 1 },
    { mode: 'fill' as const, cx: 0.9, cy: 0.1, zoom: 2.5 },
  ]) {
    expectCoversBleed(4000, 1000, clampCrop(4000, 1000, crop));
  }
});

test('clampCrop keeps a centered crop unchanged', () => {
  expect(clampCrop(1000, 1500, DEFAULT_CROP)).toEqual(DEFAULT_CROP);
});

test('clampCrop limits zoom to 8', () => {
  expect(clampCrop(1000, 1500, { ...DEFAULT_CROP, zoom: 20 }).zoom).toBe(8);
});

test('clampCrop in fit mode limits center to the image', () => {
  expect(clampCrop(1000, 1500, { mode: 'fit', cx: -0.4, cy: 1.7, zoom: 1 })).toEqual({ mode: 'fit', cx: 0, cy: 1, zoom: 1 });
});

test('isLowRes', () => {
  expect(isLowRes(780, 1170, DEFAULT_CROP)).toBe(false); // TMDB w780
  expect(isLowRes(185, 278, DEFAULT_CROP)).toBe(true); // 썸네일 크기
  expect(isLowRes(780, 1170, { ...DEFAULT_CROP, zoom: 4 })).toBe(true);
});

test('imagePointAt maps a stamp point to image coords and rejects points outside', () => {
  const crop: Crop = { mode: 'fit', cx: 0.5, cy: 0.5, zoom: 1 };
  expect(imagePointAt(780, 1170, crop, STAMP_W_MM / 2, STAMP_H_MM / 2)).toEqual({ u: 0.5, v: 0.5 });
  expect(imagePointAt(780, 1170, crop, 0.5, STAMP_H_MM / 2)).toBeNull();
});
