/**
 * 2D 아핀 변환. 캔버스 `setTransform(a, b, c, d, e, f)`와 같은 의미다.
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 */
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** inner를 먼저 적용한 뒤 outer를 적용하는 변환. */
export function compose(outer: Affine, inner: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function apply(m: Affine, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

export function scale(s: number): Affine {
  return [s, 0, 0, s, 0, 0];
}

export function translate(x: number, y: number): Affine {
  return [1, 0, 0, 1, x, y];
}
