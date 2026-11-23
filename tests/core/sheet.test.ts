import { apply, compose } from '../../src/core/affine';
import { DEFAULT_CALIBRATION, calibrationAffine } from '../../src/core/calibration';
import { BLEED_RECT, DEFAULT_CROP, placeImage } from '../../src/core/crop';
import { PX_PER_MM, PX_TRANSFORM, SHEET_PX, SLOTS } from '../../src/core/layout';
import { chunkIntoSheets, paintSheet, paintTestSheet, slotMatrix, type SheetEntry } from '../../src/core/sheet';
import { fakeCtx } from '../helpers/fakeCtx';

const closeTo = (n: number) => expect.closeTo(n, 3);

function entry(width: number, height: number): SheetEntry {
  return { image: { width, height } as unknown as SheetEntry['image'], crop: DEFAULT_CROP };
}

function corners(r: { xMm: number; yMm: number; wMm: number; hMm: number }): [number, number][] {
  return [
    [r.xMm, r.yMm],
    [r.xMm + r.wMm, r.yMm],
    [r.xMm, r.yMm + r.hMm],
    [r.xMm + r.wMm, r.yMm + r.hMm],
  ];
}

test('chunkIntoSheets', () => {
  expect(chunkIntoSheets([1, 2, 3, 4, 5])).toEqual([[1, 2, 3], [4, 5]]);
  expect(chunkIntoSheets([1, 2, 3])).toEqual([[1, 2, 3]]);
  expect(chunkIntoSheets([])).toEqual([]);
});

test('slotMatrix maps the portrait origin to the slot corner in px', () => {
  expect(apply(slotMatrix(SLOTS[0], DEFAULT_CALIBRATION), 0, 0)).toEqual([
    closeTo(SLOTS[0].xMm * PX_PER_MM),
    closeTo(SLOTS[0].yMm * PX_PER_MM),
  ]);
});

test('paintSheet fills the sheet white first', () => {
  const ctx = fakeCtx();
  paintSheet(ctx, [], DEFAULT_CALIBRATION);
  const fill = ctx.calls.find((c) => c.name === 'fillRect');
  expect(fill?.args).toEqual([0, 0, SHEET_PX, SHEET_PX]);
  expect(fill?.transform).toEqual([1, 0, 0, 1, 0, 0]);
});

test('paintSheet draws each filled slot with its slot matrix and bleed clip', () => {
  const ctx = fakeCtx();
  paintSheet(ctx, [entry(1000, 1500), null, entry(1000, 1500)], DEFAULT_CALIBRATION);
  const draws = ctx.calls.filter((c) => c.name === 'drawImage');
  expect(draws).toHaveLength(2);
  expect(ctx.transformsAtDraw[0]).toEqual(slotMatrix(SLOTS[0], DEFAULT_CALIBRATION));
  expect(ctx.transformsAtDraw[1]).toEqual(slotMatrix(SLOTS[2], DEFAULT_CALIBRATION));
  expect(ctx.clipRects[0]).toEqual([-1, -1, 33.7, 40.1]);
  const r = placeImage(1000, 1500, DEFAULT_CROP);
  expect(draws[0].args.slice(1)).toEqual([r.xMm, r.yMm, r.wMm, r.hMm]);
});

test('paintSheet fills a slot bleed with crop.bg, white when absent', () => {
  const ctx = fakeCtx();
  const fit = { mode: 'fit' as const, cx: 0.5, cy: 0.5, zoom: 1 };
  paintSheet(
    ctx,
    [
      { ...entry(1000, 1500), crop: { ...fit, bg: '#123456' } },
      { ...entry(1000, 1500), crop: fit },
    ],
    DEFAULT_CALIBRATION,
  );
  const slotFills = ctx.calls.filter((c) => c.name === 'fillRect' && c.args[0] === BLEED_RECT.xMm);
  expect(slotFills.map((c) => c.style)).toEqual(['#123456', '#ffffff']);
});

test('paintSheet restores state after every slot', () => {
  const ctx = fakeCtx();
  paintSheet(ctx, [entry(1000, 1500), entry(1000, 1500), entry(1000, 1500)], DEFAULT_CALIBRATION);
  const saves = ctx.calls.filter((c) => c.name === 'save').length;
  expect(saves).toBe(3);
  expect(ctx.calls.filter((c) => c.name === 'restore').length).toBe(saves);
});

test('paintSheet applies calibration', () => {
  const cal = { scalePct: 102, offsetXMm: 0.5, offsetYMm: -0.3 };
  const ctx = fakeCtx();
  paintSheet(ctx, [entry(1000, 1500)], cal);
  expect(ctx.transformsAtDraw[0]).toEqual(slotMatrix(SLOTS[0], cal));
  expect(slotMatrix(SLOTS[0], cal)).not.toEqual(slotMatrix(SLOTS[0], DEFAULT_CALIBRATION));
});

test('slot 3 bleed lands inside the paper in px', () => {
  const m = slotMatrix(SLOTS[2], DEFAULT_CALIBRATION);
  for (const [x, y] of corners(BLEED_RECT)) {
    const [px, py] = apply(m, x, y);
    expect(px).toBeGreaterThanOrEqual(0);
    expect(px).toBeLessThanOrEqual(SHEET_PX);
    expect(py).toBeGreaterThanOrEqual(0);
    expect(py).toBeLessThanOrEqual(SHEET_PX);
  }
});

test('paintTestSheet strokes three cut outlines', () => {
  const ctx = fakeCtx();
  paintTestSheet(ctx, DEFAULT_CALIBRATION);
  const strokes = ctx.calls.filter((c) => c.name === 'strokeRect');
  for (const slot of SLOTS) {
    const outlines = strokes.filter(
      (c) => JSON.stringify(c.transform) === JSON.stringify(slotMatrix(slot, DEFAULT_CALIBRATION)),
    );
    expect(outlines).toHaveLength(1);
    expect(outlines[0].args).toEqual([0, 0, 31.7, 38.1]);
  }
});

test('paintTestSheet draws the 2mm inner edge line with calibration', () => {
  const cal = { scalePct: 101, offsetXMm: 0.2, offsetYMm: 0 };
  const ctx = fakeCtx();
  paintTestSheet(ctx, cal);
  const paper = compose(PX_TRANSFORM, calibrationAffine(cal));
  const edge = ctx.calls.find(
    (c) => c.name === 'strokeRect' && JSON.stringify(c.transform) === JSON.stringify(paper),
  );
  expect(edge?.args).toEqual([2, 2, closeTo(72.2), closeTo(72.2)]);
});

test('paintTestSheet draws 50mm rulers with 1/5/10mm ticks', () => {
  const ctx = fakeCtx();
  paintTestSheet(ctx, DEFAULT_CALIBRATION);
  // 가로·세로 눈금자마다 0~50mm 눈금 51개 + 기준선 1개
  expect(ctx.calls.filter((c) => c.name === 'moveTo').length).toBeGreaterThanOrEqual(2 * 52);
});
