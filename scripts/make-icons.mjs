// 앱 아이콘 PNG를 의존성 없이 만든다: node scripts/make-icons.mjs
// 주황 바탕 위에 톱니 가장자리 흰 우표, 그 안에 어두운 포스터와 해.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [180, 68, 31, 255];
const PAPER = [255, 253, 248, 255];
const POSTER = [31, 26, 23, 255];
const SUN = [244, 177, 92, 255];

/** 좌표는 0~1 정규화. 우표는 마스커블 안전 영역(가운데 80%) 안에 들어간다. */
function icon(u, v) {
  const w = 0.46;
  const h = w * (38.1 / 31.7);
  const x0 = 0.5 - w / 2;
  const y0 = 0.5 - h / 2;
  const inStamp = u >= x0 && u <= x0 + w && v >= y0 && v <= y0 + h;
  if (!inStamp) return BG;
  // 톱니: 가장자리를 따라 일정 간격으로 반원 구멍
  const pitch = w / 9;
  const r = pitch * 0.3;
  const holes = [
    [u, y0],
    [u, y0 + h],
    [x0, v],
    [x0 + w, v],
  ].some(([hx, hy], i) => {
    const along = i < 2 ? hx - x0 : hy - y0;
    const len = i < 2 ? w : h;
    const n = Math.round(len / pitch);
    const step = len / n;
    const k = Math.round(along / step);
    const cx = i < 2 ? x0 + k * step : hx;
    const cy = i < 2 ? hy : y0 + k * step;
    return Math.hypot(u - cx, v - cy) < r;
  });
  if (holes) return BG;
  const m = w * 0.12;
  const inPoster = u >= x0 + m && u <= x0 + w - m && v >= y0 + m && v <= y0 + h - m;
  if (!inPoster) return PAPER;
  if (Math.hypot(u - 0.5, v - (y0 + h * 0.42)) < w * 0.17) return SUN;
  // 아래쪽 산 실루엣
  const groundY = y0 + h - m - (h - 2 * m) * 0.28 + Math.sin((u - x0) * 18) * h * 0.03;
  if (v > groundY) return [90, 50, 36, 255];
  return POSTER;
}

/** 4×4 슈퍼샘플링으로 가장자리를 부드럽게 */
function smooth(size) {
  return (x, y) => {
    const acc = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const c = icon((x - 0.5 + (i + 0.5) / 4) / size, (y - 0.5 + (j + 0.5) / 4) / size);
        for (let k = 0; k < 4; k++) acc[k] += c[k];
      }
    }
    return acc.map((a) => Math.round(a / 16));
  };
}

mkdirSync('public/icons', { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`public/icons/icon-${size}.png`, png(size, smooth(size)));
}
writeFileSync('public/icons/apple-touch-icon.png', png(180, smooth(180)));
console.log('icons written to public/icons');
