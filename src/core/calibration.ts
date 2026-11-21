import { type Affine, compose, scale, translate } from './affine';
import { PAPER_MM } from './layout';

export interface Calibration {
  scalePct: number;
  offsetXMm: number;
  offsetYMm: number;
}

export const DEFAULT_CALIBRATION: Calibration = { scalePct: 100, offsetXMm: 0, offsetYMm: 0 };

/** 종이 mm → 보정된 종이 mm. 인화지 중심 기준으로 확대/축소한 뒤 오프셋을 더한다. */
export function calibrationAffine(cal: Calibration): Affine {
  const c = PAPER_MM / 2;
  const scaled = compose(translate(c, c), compose(scale(cal.scalePct / 100), translate(-c, -c)));
  return compose(translate(cal.offsetXMm, cal.offsetYMm), scaled);
}
