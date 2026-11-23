import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { type Crop, DEFAULT_CROP, clampCrop } from '../../src/core/crop';
import type { Pixels } from '../../src/core/palette';
import { type Stamp, addStamp, closeDb, getStamp } from '../../src/data/db';
import type { Tmdb } from '../../src/tmdb/client';
import { AppContext, type AppContextValue } from '../../src/ui/context';
import { CropEditor, type ImageLike, frameLayout } from '../../src/ui/CropEditor';
import { resetDb } from '../helpers/resetDb';

beforeEach(resetDb);
afterAll(closeDb);

/** 100×150: 왼쪽·오른쪽 3열 #336699, 나머지는 위 60행 #202020, 아래 90행 #c08040 */
function posterPixels(): Pixels {
  const width = 100;
  const height = 150;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgb = x < 3 || x >= 97 ? [0x33, 0x66, 0x99] : y < 60 ? [0x20, 0x20, 0x20] : [0xc0, 0x80, 0x40];
      data.set([...rgb, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

function fakeImage(width: number, height: number): ImageLike {
  return { width, height } as unknown as ImageLike;
}

async function setup(
  opts: { size?: [number, number]; posters?: string[]; crop?: Crop; pixels?: Pixels | null } = {},
) {
  const [w, h] = opts.size ?? [780, 1170];
  const stamp = await addStamp({
    source: 'tmdb',
    tmdbId: 129,
    title: '센과 치히로의 행방불명',
    posterPath: '/a.jpg',
    crop: opts.crop ?? DEFAULT_CROP,
  });
  const tmdb: Tmdb = { searchMovies: vi.fn(), listPosters: vi.fn(async () => opts.posters ?? ['/a.jpg', '/b.jpg']) };
  const ctx: AppContextValue = {
    open: vi.fn(),
    close: vi.fn(),
    pushModal: vi.fn(() => ({ dismiss: vi.fn() })),
    refresh: vi.fn(),
    version: 0,
    settings: null,
    reloadSettings: vi.fn(),
    tmdb,
  };
  const load = vi.fn(async (_s: Stamp) => fakeImage(w, h));
  const onDone = vi.fn();
  render(
    <AppContext.Provider value={ctx}>
      <CropEditor
        stampId={stamp.id}
        onDone={onDone}
        loadStampImage={load}
        samplePixels={() => (opts.pixels === undefined ? posterPixels() : opts.pixels)}
      />
    </AppContext.Provider>,
  );
  await screen.findByRole('button', { name: '완료' });
  await waitFor(() => expect(load).toHaveBeenCalled());
  return { stamp, onDone, load, tmdb };
}

async function finish(onDone: () => void) {
  fireEvent.click(screen.getByRole('button', { name: '완료' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
}

function drag(el: Element, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: to[0], clientY: to[1] });
}

test('done without changes saves the default crop', async () => {
  const { stamp, onDone } = await setup();
  await finish(onDone);
  expect((await getStamp(stamp.id))?.crop).toEqual(DEFAULT_CROP);
});

test('drag moves the crop and the saved crop satisfies clampCrop', async () => {
  const { stamp, onDone } = await setup();
  const stage = screen.getByLabelText('포스터 위치 조정');
  await waitFor(() => expect(screen.getByText(/꽉 채우기/)).toBeTruthy());
  drag(stage, [100, 100], [40, 70]);
  drag(stage, [0, 0], [-100000, 100000]);
  await finish(onDone);
  const saved = (await getStamp(stamp.id))!.crop;
  expect(saved).not.toEqual(DEFAULT_CROP);
  expect(clampCrop(780, 1170, saved)).toEqual(saved);
});

test('switching mode resets to centered zoom 1', async () => {
  const { stamp, onDone } = await setup({ crop: { mode: 'fill', cx: 0.4, cy: 0.6, zoom: 3 } });
  fireEvent.click(screen.getByRole('button', { name: '전체 보이기' }));
  await finish(onDone);
  expect((await getStamp(stamp.id))?.crop).toMatchObject({ mode: 'fit', cx: 0.5, cy: 0.5, zoom: 1 });
});

test('zoom slider changes zoom within limits', async () => {
  const { stamp, onDone } = await setup();
  fireEvent.input(screen.getByRole('slider', { name: '확대' }), { target: { value: '2.5' } });
  await finish(onDone);
  expect((await getStamp(stamp.id))?.crop.zoom).toBeCloseTo(2.5);
});

test('small image shows the low resolution warning', async () => {
  await setup({ size: [185, 278] });
  expect(await screen.findByText('해상도가 낮아 흐리게 나올 수 있어요')).toBeTruthy();
});

test('large image shows no warning', async () => {
  await setup();
  expect(screen.queryByText('해상도가 낮아 흐리게 나올 수 있어요')).toBeNull();
});

test('choosing another poster changes posterPath and resets the crop', async () => {
  const { stamp, onDone, load } = await setup({ crop: { mode: 'fill', cx: 0.4, cy: 0.6, zoom: 2 } });
  fireEvent.click(await screen.findByRole('button', { name: '포스터 2' }));
  await waitFor(() => expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ posterPath: '/b.jpg' })));
  await finish(onDone);
  const saved = await getStamp(stamp.id);
  expect(saved?.posterPath).toBe('/b.jpg');
  expect(saved?.crop).toEqual(DEFAULT_CROP);
});

test('poster choices are requested in CORS mode', async () => {
  await setup();
  const choice = await screen.findByRole('button', { name: '포스터 2' });
  expect(choice.querySelector('img')?.getAttribute('crossorigin')).toBe('anonymous');
});

const marginRow = () => screen.queryByRole('group', { name: '여백 색' });
const savedBg = async (id: string) => (await getStamp(id))?.crop.bg;

async function toFit() {
  fireEvent.click(screen.getByRole('button', { name: '전체 보이기' }));
  await waitFor(() => expect(marginRow()).toBeTruthy());
}

test('margin row appears only in fit mode', async () => {
  await setup();
  expect(marginRow()).toBeNull();
  await toFit();
});

test('switching to fit for the first time picks the edge color', async () => {
  const { stamp, onDone } = await setup();
  await toFit();
  await waitFor(() => expect(screen.getByRole('button', { name: '가장자리 색' }).getAttribute('aria-pressed')).toBe('true'));
  await finish(onDone);
  expect(await savedBg(stamp.id)).toBe('#336699');
});

test('an existing fit stamp without bg stays white', async () => {
  const { stamp, onDone } = await setup({ crop: { mode: 'fit', cx: 0.5, cy: 0.5, zoom: 1 } });
  await waitFor(() => expect(marginRow()).toBeTruthy());
  expect(screen.getByRole('button', { name: '흰색' }).getAttribute('aria-pressed')).toBe('true');
  await finish(onDone);
  expect(await savedBg(stamp.id)).toBeUndefined();
});

test('poster color chips set bg and white sets white', async () => {
  const { stamp, onDone } = await setup();
  await toFit();
  fireEvent.click(await screen.findByRole('button', { name: '포스터 색 1' }));
  expect(screen.getByRole('button', { name: '포스터 색 2' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '흰색' }));
  expect(screen.getByRole('button', { name: '흰색' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '포스터 색 1' }));
  await finish(onDone);
  expect(await savedBg(stamp.id)).toBe('#c08040');
});

test('white chip saves white', async () => {
  const { stamp, onDone } = await setup();
  await toFit();
  fireEvent.click(screen.getByRole('button', { name: '흰색' }));
  await finish(onDone);
  expect(await savedBg(stamp.id)).toBe('#ffffff');
});

test('bg survives switching to fill and back', async () => {
  const { stamp, onDone } = await setup();
  await toFit();
  fireEvent.click(await screen.findByRole('button', { name: '포스터 색 2' }));
  fireEvent.click(screen.getByRole('button', { name: '꽉 채우기' }));
  await waitFor(() => expect(marginRow()).toBeNull());
  await toFit();
  await finish(onDone);
  expect(await savedBg(stamp.id)).toBe('#202020');
});

test('custom color input sets bg', async () => {
  const { stamp, onDone } = await setup();
  await toFit();
  fireEvent.input(screen.getByLabelText('직접 고르기'), { target: { value: '#abcdef' } });
  await finish(onDone);
  expect(await savedBg(stamp.id)).toBe('#abcdef');
});

test('eyedropper picks the color under a tap and ignores taps on the margin', async () => {
  const { stamp, onDone } = await setup();
  await toFit();
  const stage = screen.getByLabelText('포스터 위치 조정');
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 600 } as DOMRect);
  const { k, fx, fy } = frameLayout(400, 600);
  const at = (xMm: number, yMm: number) => ({ pointerId: 1, clientX: fx + xMm * k, clientY: fy + yMm * k });

  fireEvent.click(screen.getByRole('button', { name: '스포이드' }));
  expect(screen.getByText('포스터를 눌러 색을 고르세요')).toBeTruthy();
  // 780×1170 포스터는 전체 보이기에서 x 3.15mm부터 시작하므로 1mm는 여백
  fireEvent.pointerDown(stage, at(1, 19));
  fireEvent.pointerUp(stage, at(1, 19));
  expect(screen.getByText('포스터를 눌러 색을 고르세요')).toBeTruthy();
  // 아래쪽 가운데는 #c08040. 스포이드 중의 끌기는 위치를 바꾸지 않는다
  fireEvent.pointerDown(stage, at(15.85, 30));
  fireEvent.pointerMove(stage, at(5, 5));
  fireEvent.pointerUp(stage, at(5, 5));
  await waitFor(() => expect(screen.queryByText('포스터를 눌러 색을 고르세요')).toBeNull());
  await finish(onDone);
  const crop = (await getStamp(stamp.id))!.crop;
  expect(crop.bg).toBe('#c08040');
  expect(crop).toMatchObject({ cx: 0.5, cy: 0.5 });
});

test('without readable pixels only white and custom are offered', async () => {
  const { stamp, onDone } = await setup({ pixels: null });
  await toFit();
  expect(screen.queryByRole('button', { name: '가장자리 색' })).toBeNull();
  expect(screen.queryByRole('button', { name: '포스터 색 1' })).toBeNull();
  expect(screen.queryByRole('button', { name: '스포이드' })).toBeNull();
  expect(screen.getByRole('button', { name: '흰색' })).toBeTruthy();
  expect(screen.getByLabelText('직접 고르기')).toBeTruthy();
  await finish(onDone);
  expect(await savedBg(stamp.id)).toBeUndefined();
});
