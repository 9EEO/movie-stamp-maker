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

describe('several photos at once', () => {
  const jpg = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

  function setupUpload(prepare: (f: Blob) => Promise<Blob> = async (f) => f) {
    const onAdded = vi.fn();
    const onAddedMany = vi.fn();
    render(
      <Search tmdb={null} onOpenSettings={vi.fn()} onAdded={onAdded} onAddedMany={onAddedMany} prepareUpload={prepare} />,
    );
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    return { input, onAdded, onAddedMany };
  }

  function pick(input: HTMLInputElement, files: File[]) {
    fireEvent.change(input, { target: { files } });
  }

  test('the photo picker allows multiple selection', () => {
    const { input } = setupUpload();
    expect(input.multiple).toBe(true);
  });

  test('each photo gets a title field filled from its file name', async () => {
    const { input } = setupUpload();
    pick(input, [jpg('토토로.jpg'), jpg('붉은 돼지.png'), jpg('IMG_0001.jpeg')]);
    const fields = (await screen.findAllByRole('textbox', { name: /제목/ })) as HTMLInputElement[];
    expect(fields.map((f) => f.value)).toEqual(['토토로', '붉은 돼지', 'IMG_0001']);
    expect(screen.getByRole('button', { name: '3장 모두 추가' })).toBeTruthy();
  });

  test('adding several puts them all in the queue in order without opening the editor', async () => {
    const { input, onAdded, onAddedMany } = setupUpload();
    pick(input, [jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')]);
    const fields = (await screen.findAllByRole('textbox', { name: /제목/ })) as HTMLInputElement[];
    fireEvent.input(fields[1], { target: { value: '바꾼 제목' } });
    fireEvent.click(screen.getByRole('button', { name: '3장 모두 추가' }));
    await waitFor(() => expect(onAddedMany).toHaveBeenCalledWith(3, 0, false));
    expect((await listQueue()).map((s) => s.title)).toEqual(['a', '바꾼 제목', 'c']);
    expect((await listQueue()).every((s) => s.source === 'upload' && s.blobId)).toBe(true);
    expect(onAdded).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('textbox', { name: /제목/ })).toHaveLength(0);
  });

  test('photos that cannot be opened are skipped and counted', async () => {
    const { input, onAddedMany } = setupUpload(async (f) => {
      if ((f as File).name.endsWith('.heic')) throw new Error('decode');
      return f;
    });
    pick(input, [jpg('a.jpg'), jpg('b.heic'), jpg('c.jpg')]);
    fireEvent.click(await screen.findByRole('button', { name: '3장 모두 추가' }));
    await waitFor(() => expect(onAddedMany).toHaveBeenCalledWith(2, 1, false));
    expect((await listQueue()).map((s) => s.title)).toEqual(['a', 'c']);
  });

  test('a photo can be removed from the list before adding', async () => {
    const { input, onAddedMany } = setupUpload();
    pick(input, [jpg('a.jpg'), jpg('b.jpg')]);
    fireEvent.click((await screen.findAllByRole('button', { name: /목록에서 빼기/ }))[0]);
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    await waitFor(async () => expect((await listQueue()).map((s) => s.title)).toEqual(['b']));
    expect(onAddedMany).not.toHaveBeenCalled();
  });

  test('a single photo still opens the crop editor', async () => {
    const { input, onAdded } = setupUpload();
    pick(input, [jpg('a.jpg')]);
    fireEvent.click(await screen.findByRole('button', { name: '추가' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    const [stamp] = await listQueue();
    expect(onAdded).toHaveBeenCalledWith(stamp.id);
  });

  test('add is disabled while a title is empty', async () => {
    const { input } = setupUpload();
    pick(input, [jpg('a.jpg'), jpg('b.jpg')]);
    const fields = await screen.findAllByRole('textbox', { name: /제목/ });
    fireEvent.input(fields[0], { target: { value: '  ' } });
    expect((screen.getByRole('button', { name: '2장 모두 추가' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
