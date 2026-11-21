import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { DEFAULT_CROP } from '../../src/core/crop';
import { addStamp, closeDb, getStamp, listMade, listQueue, markMade } from '../../src/data/db';
import { MadeGallery, StampDetail } from '../../src/ui/MadeGallery';
import { AppHarness } from '../helpers/appHarness';
import { resetDb } from '../helpers/resetDb';

beforeEach(resetDb);
afterAll(closeDb);
afterEach(() => vi.restoreAllMocks());

async function made(title: string, madeAt: number, tmdbId = madeAt) {
  const s = await addStamp({ source: 'tmdb', tmdbId, title, year: 2001, posterPath: `/${tmdbId}.jpg`, crop: DEFAULT_CROP });
  await markMade([s.id], madeAt);
  return s;
}

test('gallery lists made stamps newest first with a count', async () => {
  await made('센과 치히로의 행방불명', 100);
  await made('이웃집 토토로', 300);
  await made('붉은 돼지', 200);
  render(
    <AppHarness>
      <MadeGallery />
    </AppHarness>,
  );
  expect(await screen.findByRole('heading', { name: '만든 우표 (3)' })).toBeTruthy();
  const thumbs = screen.getAllByRole('button', { name: /보기$/ });
  expect(thumbs.map((b) => b.getAttribute('aria-label'))).toEqual([
    '이웃집 토토로 보기',
    '붉은 돼지 보기',
    '센과 치히로의 행방불명 보기',
  ]);
});

test('title search filters the grid', async () => {
  await made('센과 치히로의 행방불명', 100);
  await made('이웃집 토토로', 300);
  render(
    <AppHarness>
      <MadeGallery />
    </AppHarness>,
  );
  await screen.findByRole('heading', { name: '만든 우표 (2)' });
  fireEvent.input(screen.getByRole('searchbox', { name: '만든 우표 제목 검색' }), { target: { value: '토토' } });
  await waitFor(() => expect(screen.getAllByRole('button', { name: /보기$/ })).toHaveLength(1));
  expect(screen.getByRole('button', { name: '이웃집 토토로 보기' })).toBeTruthy();
});

test('tapping a stamp opens its detail', async () => {
  const s = await made('이웃집 토토로', 300);
  const open = vi.fn();
  render(
    <AppHarness open={open}>
      <MadeGallery />
    </AppHarness>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '이웃집 토토로 보기' }));
  expect(open).toHaveBeenCalledWith({ kind: 'detail', stampId: s.id });
});

function renderDetail(id: string) {
  render(
    <AppHarness>
      <StampDetail stampId={id} />
    </AppHarness>,
  );
}

test('detail shows title, year and made date', async () => {
  const s = await made('이웃집 토토로', new Date(2026, 10, 21, 14, 30).getTime());
  renderDetail(s.id);
  expect(await screen.findByText('이웃집 토토로')).toBeTruthy();
  expect(screen.getByText('2001')).toBeTruthy();
  expect(screen.getByText(/2026\. 11\. 21\./)).toBeTruthy();
});

test('다시 만들기 adds a copy to the queue and keeps the original', async () => {
  const s = await made('이웃집 토토로', 300);
  renderDetail(s.id);
  fireEvent.click(await screen.findByRole('button', { name: '다시 만들기' }));
  await waitFor(async () => expect(await listQueue()).toHaveLength(1));
  const [copy] = await listQueue();
  expect(copy.id).not.toBe(s.id);
  expect(copy).toMatchObject({ title: '이웃집 토토로', tmdbId: 300, posterPath: '/300.jpg', status: 'queued' });
  expect((await getStamp(s.id))?.status).toBe('made');
  expect(await listMade()).toHaveLength(1);
});

test('대기열로 되돌리기 moves the stamp back to the queue', async () => {
  const s = await made('이웃집 토토로', 300);
  renderDetail(s.id);
  fireEvent.click(await screen.findByRole('button', { name: '대기열로 되돌리기' }));
  await waitFor(async () => expect((await listQueue()).map((x) => x.id)).toEqual([s.id]));
  expect(await listMade()).toEqual([]);
});

test('삭제 only after confirmation', async () => {
  const s = await made('이웃집 토토로', 300);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  renderDetail(s.id);
  fireEvent.click(await screen.findByRole('button', { name: '삭제' }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(await getStamp(s.id)).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '삭제' }));
  await waitFor(async () => expect(await getStamp(s.id)).toBeUndefined());
});
