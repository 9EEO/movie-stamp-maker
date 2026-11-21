import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { DEFAULT_CROP } from '../../src/core/crop';
import { addStamp, closeDb, listQueue } from '../../src/data/db';
import { type MovieResult, type Tmdb, TmdbError } from '../../src/tmdb/client';
import { Search } from '../../src/ui/Search';
import { resetDb } from '../helpers/resetDb';

beforeEach(resetDb);
afterAll(closeDb);

const results: MovieResult[] = [
  { tmdbId: 129, title: '센과 치히로의 행방불명', year: 2001, posterPath: '/abc.jpg' },
  { tmdbId: 7, title: '포스터 없는 영화', posterPath: null },
];

function fakeTmdb(search: () => Promise<MovieResult[]>): Tmdb {
  return { searchMovies: vi.fn(search), listPosters: vi.fn(async () => []) };
}

function setup(tmdb: Tmdb | null) {
  const onOpenSettings = vi.fn();
  const onAdded = vi.fn();
  render(<Search tmdb={tmdb} onOpenSettings={onOpenSettings} onAdded={onAdded} />);
  return { onOpenSettings, onAdded };
}

function typeQuery(text: string) {
  fireEvent.input(screen.getByRole('searchbox'), { target: { value: text } });
}

test('without a key it explains, links to settings and keeps upload enabled', () => {
  const { onOpenSettings } = setup(null);
  expect(screen.getByText('TMDB 키를 설정하면 영화를 검색할 수 있어요')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '설정 열기' }));
  expect(onOpenSettings).toHaveBeenCalled();
  expect((screen.getByRole('button', { name: /내 사진/ }) as HTMLButtonElement).disabled).toBe(false);
});

test('search is debounced and shows results with year', async () => {
  const tmdb = fakeTmdb(async () => results);
  setup(tmdb);
  typeQuery('센');
  typeQuery('센과');
  typeQuery('센과 치히로');
  expect(await screen.findByText('센과 치히로의 행방불명')).toBeTruthy();
  expect(tmdb.searchMovies).toHaveBeenCalledTimes(1);
  expect(tmdb.searchMovies).toHaveBeenCalledWith('센과 치히로');
  expect(screen.getByText('2001')).toBeTruthy();
});

test('auth error tells the key is wrong and links to settings', async () => {
  const { onOpenSettings } = setup(
    fakeTmdb(async () => {
      throw new TmdbError('auth');
    }),
  );
  typeQuery('x');
  expect(await screen.findByText('TMDB 키가 올바르지 않아요')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '설정 열기' }));
  expect(onOpenSettings).toHaveBeenCalled();
});

test('network error asks to check the connection', async () => {
  setup(
    fakeTmdb(async () => {
      throw new TmdbError('network');
    }),
  );
  typeQuery('x');
  expect(await screen.findByText('인터넷 연결을 확인해 주세요')).toBeTruthy();
  expect((screen.getByRole('button', { name: /내 사진/ }) as HTMLButtonElement).disabled).toBe(false);
});

test('result without poster shows 포스터 없음 and cannot be added', async () => {
  const { onAdded } = setup(fakeTmdb(async () => results));
  typeQuery('x');
  const row = (await screen.findByText('포스터 없는 영화')).closest('button')!;
  expect(row.textContent).toContain('포스터 없음');
  expect(row.disabled).toBe(true);
  fireEvent.click(row);
  expect(onAdded).not.toHaveBeenCalled();
  expect(await listQueue()).toEqual([]);
});

test('existing tmdbId shows 이미 있음 and can still be added', async () => {
  await addStamp({ source: 'tmdb', tmdbId: 129, title: 'old', posterPath: '/old.jpg', crop: DEFAULT_CROP });
  const { onAdded } = setup(fakeTmdb(async () => results));
  typeQuery('x');
  expect(await screen.findByText('이미 있음')).toBeTruthy();
  fireEvent.click(screen.getByText('센과 치히로의 행방불명').closest('button')!);
  await waitFor(() => expect(onAdded).toHaveBeenCalled());
  const queue = await listQueue();
  expect(queue).toHaveLength(2);
  expect(queue[1]).toMatchObject({ tmdbId: 129, title: '센과 치히로의 행방불명', year: 2001, posterPath: '/abc.jpg' });
  expect(onAdded).toHaveBeenCalledWith(queue[1].id);
});

test('poster thumbnails are requested in CORS mode so the image cache stays usable for printing', async () => {
  setup(fakeTmdb(async () => results));
  typeQuery('x');
  const row = (await screen.findByText('센과 치히로의 행방불명')).closest('button')!;
  expect(row.querySelector('img')?.getAttribute('crossorigin')).toBe('anonymous');
});

test('a photo that cannot be opened shows an error and adds nothing', async () => {
  setup(null);
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['not an image'], 'broken.heic', { type: 'image/heic' })] } });
  fireEvent.click(await screen.findByRole('button', { name: '추가' }));
  expect(await screen.findByText('이 사진을 열 수 없어요. JPG나 PNG로 다시 골라 주세요')).toBeTruthy();
  expect(await listQueue()).toEqual([]);
  expect((screen.getByRole('button', { name: '추가' }) as HTMLButtonElement).disabled).toBe(false);
});
