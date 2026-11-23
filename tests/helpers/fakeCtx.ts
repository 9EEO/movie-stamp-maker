import { type Affine, IDENTITY } from '../../src/core/affine';

export interface Call {
  name: string;
  args: unknown[];
  transform: Affine;
  /** fillRect일 때 그 순간의 fillStyle */
  style?: string;
}

/** 호출을 기록하는 가짜 CanvasRenderingContext2D. 변환·save/restore·clip만 흉내 낸다. */
export function fakeCtx() {
  let transform: Affine = IDENTITY;
  const stack: Affine[] = [];
  let path: number[][] = [];
  const calls: Call[] = [];
  const transformsAtDraw: Affine[] = [];
  const clipRects: number[][] = [];

  const record = (name: string, args: unknown[]) => calls.push({ name, args, transform });

  const ctx = {
    calls,
    transformsAtDraw,
    clipRects,
    fillStyle: '' as string,
    strokeStyle: '' as string,
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    save() {
      stack.push(transform);
      record('save', []);
    },
    restore() {
      transform = stack.pop() ?? IDENTITY;
      record('restore', []);
    },
    setTransform(...m: number[]) {
      transform = m as unknown as Affine;
      record('setTransform', m);
    },
    beginPath() {
      path = [];
      record('beginPath', []);
    },
    rect(...r: number[]) {
      path.push(r);
      record('rect', r);
    },
    clip() {
      clipRects.push(...path);
      record('clip', []);
    },
    fillRect(...r: number[]) {
      calls.push({ name: 'fillRect', args: r, transform, style: ctx.fillStyle });
    },
    drawImage(...args: unknown[]) {
      transformsAtDraw.push(transform);
      record('drawImage', args);
    },
  };

  // 기록만 하는 나머지 메서드
  for (const name of ['strokeRect', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillText', 'closePath']) {
    (ctx as Record<string, unknown>)[name] = (...args: unknown[]) => record(name, args);
  }

  return ctx as typeof ctx & CanvasRenderingContext2D;
}
