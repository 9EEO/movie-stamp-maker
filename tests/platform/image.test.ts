import { MAX_UPLOAD_EDGE, uploadSize } from '../../src/platform/image';

test('small photos keep their size', () => {
  expect(uploadSize(1200, 1800)).toEqual({ width: 1200, height: 1800, scaled: false });
  expect(uploadSize(MAX_UPLOAD_EDGE, 100)).toEqual({ width: MAX_UPLOAD_EDGE, height: 100, scaled: false });
});

test('large photos shrink so the long edge fits, keeping the aspect ratio', () => {
  expect(uploadSize(4000, 3000)).toEqual({ width: MAX_UPLOAD_EDGE, height: 1800, scaled: true });
  expect(uploadSize(3000, 8000)).toEqual({ width: 900, height: MAX_UPLOAD_EDGE, scaled: true });
});

test('the limit still leaves enough pixels for a sharp print at zoom 1', () => {
  expect(MAX_UPLOAD_EDGE).toBeGreaterThanOrEqual(2000);
});
