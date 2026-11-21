import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { DEFAULT_CROP } from '../../src/core/crop';
import { addStamp, closeDb, getSettings, listQueue, saveSettings } from '../../src/data/db';
import { type Tmdb, TmdbError } from '../../src/tmdb/client';
import { Settings, type SettingsDeps } from '../../src/ui/Settings';
import { AppHarness } from '../helpers/appHarness';
import { resetDb } from '../helpers/resetDb';

beforeEach(resetDb);
afterAll(closeDb);

function tmdbThat(search: () => Promise<never[]>): Tmdb {
  return { searchMovies: vi.fn(search), listPosters: vi.fn() };
}

function deps(overrides: Partial<SettingsDeps> = {}): SettingsDeps {
  return {
    makeTmdb: () => tmdbThat(async () => []),
    renderTestSheet: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    canShareFiles: () => false,
    shareFile: vi.fn(async () => 'shared' as const),
    saveFile: vi.fn(),
    ...overrides,
  };
}

async function setup(d: SettingsDeps) {
  render(
    <AppHarness>
      <Settings deps={d} />
    </AppHarness>,
  );
  await screen.findByRole('dialog', { name: '설정' });
}

function setValue(label: string, value: string) {
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

test('saving a valid key stores it and says so', async () => {
  await setup(deps());
  setValue('TMDB API 키', 'eyJgoodtoken');
  fireEvent.click(screen.getByRole('button', { name: '키 저장' }));
  expect(await screen.findByText('키가 확인됐어요')).toBeTruthy();
  expect((await getSettings()).tmdbKey).toBe('eyJgoodtoken');
});

test('wrong key shows the auth message and is not saved', async () => {
  await setup(
    deps({
      makeTmdb: () =>
        tmdbThat(async () => {
          throw new TmdbError('auth');
        }),
    }),
  );
  setValue('TMDB API 키', 'bad');
  fireEvent.click(screen.getByRole('button', { name: '키 저장' }));
  expect(await screen.findByText('TMDB 키가 올바르지 않아요')).toBeTruthy();
  expect((await getSettings()).tmdbKey).toBeUndefined();
});

test('offline key check still saves the key with a note', async () => {
  await setup(
    deps({
      makeTmdb: () =>
        tmdbThat(async () => {
          throw new TmdbError('network');
        }),
    }),
  );
  setValue('TMDB API 키', 'k');
  fireEvent.click(screen.getByRole('button', { name: '키 저장' }));
  expect(await screen.findByText(/인터넷 연결을 확인하지 못했어요/)).toBeTruthy();
  expect((await getSettings()).tmdbKey).toBe('k');
});

test('saving calibration marks calibrated and keeps the values', async () => {
  await setup(deps());
  setValue('배율 (%)', '101.5');
  setValue('가로 오프셋 (mm)', '0.3');
  setValue('세로 오프셋 (mm)', '-0.2');
  fireEvent.click(screen.getByRole('button', { name: '보정값 저장' }));
  await waitFor(async () =>
    expect(await getSettings()).toMatchObject({
      calibrated: true,
      calibration: { scalePct: 101.5, offsetXMm: 0.3, offsetYMm: -0.2 },
    }),
  );
});

test('out of range calibration is refused', async () => {
  await setup(deps());
  setValue('배율 (%)', '500');
  fireEvent.click(screen.getByRole('button', { name: '보정값 저장' }));
  expect(await screen.findByText(/배율은 50~150% 사이/)).toBeTruthy();
  expect((await getSettings()).calibrated).toBe(false);
});

test('test sheet uses the calibration in the form and downloads a png', async () => {
  const d = deps();
  await setup(d);
  setValue('배율 (%)', '102');
  fireEvent.click(screen.getByRole('button', { name: '테스트 시트 저장' }));
  await waitFor(() => expect(d.saveFile).toHaveBeenCalled());
  expect(d.renderTestSheet).toHaveBeenCalledWith({ scalePct: 102, offsetXMm: 0, offsetYMm: 0 });
  expect((d.saveFile as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatch(/^test-sheet-\d{8}-\d{4}\.png$/);
});

test('export downloads a dated backup json', async () => {
  const d = deps();
  await setup(d);
  fireEvent.click(screen.getByRole('button', { name: '내보내기' }));
  await waitFor(() => expect(d.saveFile).toHaveBeenCalled());
  expect((d.saveFile as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatch(/^movie-stamps-backup-\d{8}\.json$/);
});

test('bad backup file shows an error and leaves data alone', async () => {
  await addStamp({ source: 'tmdb', tmdbId: 1, title: 'a', posterPath: '/a.jpg', crop: DEFAULT_CROP });
  const before = await listQueue();
  await setup(deps());
  const input = screen.getByLabelText('백업 파일 선택') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['{"foo":1}'], 'x.json')] } });
  expect(await screen.findByText('백업 파일을 읽을 수 없어요')).toBeTruthy();
  expect(await listQueue()).toEqual(before);
});

test('good backup file reports added and skipped counts', async () => {
  await saveSettings({ calibrated: true });
  const s = await addStamp({ source: 'tmdb', tmdbId: 1, title: 'a', posterPath: '/a.jpg', crop: DEFAULT_CROP });
  const file = {
    app: 'movie-stamp-maker',
    version: 1,
    exportedAt: 0,
    calibration: { scalePct: 100, offsetXMm: 0, offsetYMm: 0 },
    blobs: {},
    stamps: [s, { ...s, id: 'new', tmdbId: 2, title: 'b' }],
  };
  await setup(deps());
  fireEvent.change(screen.getByLabelText('백업 파일 선택'), {
    target: { files: [new File([JSON.stringify(file)], 'b.json')] },
  });
  expect(await screen.findByText('1개 추가, 1개 건너뜀')).toBeTruthy();
  expect((await listQueue()).map((x) => x.title)).toEqual(['a', 'b']);
});
