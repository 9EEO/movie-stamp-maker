import { type Pixels, colorAt, dominantColors, edgeColor, marginSides } from '../../src/core/palette';

type Rgb = [number, number, number];

function solid(width: number, height: number, rgb: Rgb): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return { data, width, height };
}

/** [x0, x1) × [y0, y1) 영역을 칠한다 */
function paint(px: Pixels, x0: number, y0: number, x1: number, y1: number, rgb: Rgb) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.data.set([...rgb, 255], (y * px.width + x) * 4);
}

test('marginSides: tall poster gets left-right margins', () => {
  expect(marginSides(780, 1170)).toBe('left-right');
  expect(marginSides(1170, 780)).toBe('top-bottom');
});

test('edgeColor averages the outer columns on both sides', () => {
  const px = solid(100, 100, [0, 255, 0]);
  paint(px, 0, 0, 3, 100, [255, 0, 0]);
  paint(px, 97, 0, 100, 100, [0, 0, 255]);
  expect(edgeColor(px, 'left-right')).toBe('#800080');
});

test('edgeColor top-bottom uses the outer rows', () => {
  const px = solid(100, 100, [0, 255, 0]);
  paint(px, 0, 0, 100, 3, [0, 0, 0]);
  paint(px, 0, 97, 100, 100, [255, 255, 255]);
  expect(edgeColor(px, 'top-bottom')).toBe('#808080');
});

test('dominantColors returns most used colors first, skipping near and avoided ones', () => {
  const px = solid(10, 10, [0x10, 0x20, 0x30]);
  paint(px, 0, 6, 10, 9, [0xe0, 0xc0, 0x40]);
  paint(px, 0, 9, 10, 10, [0xf0, 0xc0, 0x40]);
  expect(dominantColors(px, 3, [])).toEqual(['#102030', '#e0c040']);
  expect(dominantColors(px, 3, ['#112131'])).toEqual(['#e0c040']);
});

test('dominantColors on a single-color image returns one color', () => {
  expect(dominantColors(solid(10, 10, [5, 5, 5]), 3, [])).toEqual(['#050505']);
});

test('colorAt reads the pixel under a normalized point', () => {
  const px = solid(100, 100, [0, 255, 0]);
  paint(px, 97, 0, 100, 100, [0, 0, 255]);
  expect(colorAt(px, 0.99, 0.5)).toBe('#0000ff');
  expect(colorAt(px, 1, 1)).toBe('#0000ff');
  expect(colorAt(px, 0.5, 0.5)).toBe('#00ff00');
});
