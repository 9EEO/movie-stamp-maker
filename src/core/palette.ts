import { STAMP_H_MM, STAMP_W_MM } from './layout';

/** RGBA 픽셀 배열 (ImageData와 같은 모양) */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

type Rgb = [number, number, number];

/** 이보다 가까운 색은 같은 색으로 보고 추천에서 뺀다 (RGB 거리) */
const NEAR_DISTANCE = 48;
/** 가장자리 색을 잴 때 쓰는 바깥 줄의 비율 */
const EDGE_RATIO = 0.03;

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

export function parseHex(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 전체 보이기에서 여백이 생기는 변: 포스터가 우표보다 세로로 길면 좌우 */
export function marginSides(imgW: number, imgH: number): 'left-right' | 'top-bottom' {
  return imgW / imgH < STAMP_W_MM / STAMP_H_MM ? 'left-right' : 'top-bottom';
}

/** 여백이 닿는 두 변의 바깥 줄 평균색 */
export function edgeColor(px: Pixels, sides: 'left-right' | 'top-bottom'): string {
  const { data, width, height } = px;
  const sum = [0, 0, 0];
  let n = 0;
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
    n++;
  };
  if (sides === 'left-right') {
    const band = Math.max(1, Math.round(width * EDGE_RATIO));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < band; x++) {
        add(x, y);
        add(width - 1 - x, y);
      }
    }
  } else {
    const band = Math.max(1, Math.round(height * EDGE_RATIO));
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < band; y++) {
        add(x, y);
        add(x, height - 1 - y);
      }
    }
  }
  return toHex(sum[0] / n, sum[1] / n, sum[2] / n);
}

/** 많이 쓰인 색부터 count개. 서로, 그리고 avoid와 너무 비슷한 색은 건너뛴다 */
export function dominantColors(px: Pixels, count: number, avoid: string[]): string[] {
  // 채널마다 위 4비트로 묶은 4096칸에 개수와 합을 모은다
  const counts = new Uint32Array(4096);
  const sums = new Float64Array(4096 * 3);
  const { data } = px;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    counts[k]++;
    sums[k * 3] += data[i];
    sums[k * 3 + 1] += data[i + 1];
    sums[k * 3 + 2] += data[i + 2];
  }
  const buckets = [...counts.keys()].filter((k) => counts[k] > 0).sort((a, b) => counts[b] - counts[a]);
  const taken: Rgb[] = avoid.map(parseHex);
  const picked: string[] = [];
  for (const k of buckets) {
    if (picked.length >= count) break;
    const rgb: Rgb = [0, 1, 2].map((c) => Math.round(sums[k * 3 + c] / counts[k])) as Rgb;
    if (taken.some((t) => distance(t, rgb) < NEAR_DISTANCE)) continue;
    taken.push(rgb);
    picked.push(toHex(...rgb));
  }
  return picked;
}

/** 정규화 좌표(0~1)에 있는 픽셀의 색 */
export function colorAt(px: Pixels, u: number, v: number): string {
  const x = Math.min(px.width - 1, Math.floor(u * px.width));
  const y = Math.min(px.height - 1, Math.floor(v * px.height));
  const i = (y * px.width + x) * 4;
  return toHex(px.data[i], px.data[i + 1], px.data[i + 2]);
}
