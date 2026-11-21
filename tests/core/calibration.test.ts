import { apply } from '../../src/core/affine';
import { DEFAULT_CALIBRATION, calibrationAffine } from '../../src/core/calibration';

const closeTo = (n: number) => expect.closeTo(n, 3);

test('default calibration is identity', () => {
  expect(DEFAULT_CALIBRATION).toEqual({ scalePct: 100, offsetXMm: 0, offsetYMm: 0 });
  expect(apply(calibrationAffine(DEFAULT_CALIBRATION), 12.3, 45.6)).toEqual([closeTo(12.3), closeTo(45.6)]);
});

test('scale is centered on paper', () => {
  const m = calibrationAffine({ scalePct: 102, offsetXMm: 0, offsetYMm: 0 });
  expect(apply(m, 38.1, 38.1)).toEqual([closeTo(38.1), closeTo(38.1)]);
  expect(apply(m, 0, 0)).toEqual([closeTo(-0.762), closeTo(-0.762)]);
});

test('offset is added after scale', () => {
  expect(apply(calibrationAffine({ scalePct: 100, offsetXMm: 0.5, offsetYMm: -0.3 }), 10, 10)).toEqual([
    closeTo(10.5),
    closeTo(9.7),
  ]);
  // 확대 후에 오프셋을 더하므로 오프셋 자체는 배율의 영향을 받지 않는다
  expect(apply(calibrationAffine({ scalePct: 50, offsetXMm: 1, offsetYMm: 2 }), 38.1, 38.1)).toEqual([
    closeTo(39.1),
    closeTo(40.1),
  ]);
});
