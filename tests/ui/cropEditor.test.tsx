import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { type Crop, DEFAULT_CROP, clampCrop } from '../../src/core/crop';
import { type Stamp, addStamp, closeDb, getStamp } from '../../src/data/db';
import type { Tmdb } from '../../src/tmdb/client';
import { AppContext, type AppContextValue } from '../../src/ui/context';
import { CropEditor, type ImageLike } from '../../src/ui/CropEditor';
import { resetDb } from '../helpers/resetDb';

beforeEach(resetDb);
afterAll(closeDb);

function fakeImage(width: number, height: number): ImageLike {
  return { width, height } as unknown as ImageLike;
}

async function setup(opts: { size?: [number, number]; posters?: string[]; crop?: Crop } = {}) {
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
      <CropEditor stampId={stamp.id} onDone={onDone} loadStampImage={load} />
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
  expect((await getStamp(stamp.id))?.crop).toEqual({ mode: 'fit', cx: 0.5, cy: 0.5, zoom: 1 });
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
