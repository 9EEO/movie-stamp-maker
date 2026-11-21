import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { DEFAULT_CROP } from '../../src/core/crop';
import { addStamp, closeDb, getSettings, listMade, listQueue, saveSettings } from '../../src/data/db';
import { QueueSheets, type QueueDeps } from '../../src/ui/QueueSheets';
import { AppHarness } from '../helpers/appHarness';
import { resetDb } from '../helpers/resetDb';

beforeEach(async () => {
  await resetDb();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());
afterAll(closeDb);

function deps(overrides: Partial<QueueDeps> = {}): QueueDeps {
  return {
    loadStampImage: vi.fn(async () => ({ width: 780, height: 1170 }) as never),
    drawPreview: vi.fn(),
    renderSheet: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    canShareFiles: () => true,
    shareSheet: vi.fn(async () => 'shared' as const),
    saveSheet: vi.fn(),
    ...overrides,
  };
}

async function addQueued(n: number) {
  for (let i = 1; i <= n; i++) {
    await addStamp({ source: 'tmdb', tmdbId: i, title: `영화${i}`, posterPath: `/${i}.jpg`, crop: DEFAULT_CROP });
  }
}

async function setup(d: QueueDeps, open = vi.fn()) {
  render(
    <AppHarness open={open}>
      <QueueSheets deps={d} />
    </AppHarness>,
  );
  await screen.findByText(/시트 \d+장|담아 보세요/);
  return { open };
}

/** 시트의 이미지가 다 준비돼 버튼이 켜진 뒤에 누른다 */
async function clickWhenReady(name: string) {
  const btn = screen.getByRole('button', { name }) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
  fireEvent.click(btn);
}

const titles = async () => (await listQueue()).map((s) => s.title);

test('5 queued stamps make two sheet cards (3 + 2)', async () => {
  await addQueued(5);
  await setup(deps());
  expect(screen.getByText('출력 대기 5장 → 시트 2장')).toBeTruthy();
  const cards = screen.getAllByRole('article');
  expect(cards).toHaveLength(2);
  expect(within(cards[0]).getAllByRole('button', { name: /조정$/ })).toHaveLength(3);
  expect(within(cards[1]).getAllByRole('button', { name: /조정$/ })).toHaveLength(2);
});

test('empty queue shows a hint', async () => {
  await setup(deps());
  expect(screen.getByText('영화를 검색해서 우표를 담아 보세요')).toBeTruthy();
  expect(screen.queryAllByRole('article')).toHaveLength(0);
});

test('tapping a slot opens the crop editor', async () => {
  await addQueued(1);
  const { open } = await setup(deps());
  fireEvent.click(screen.getByRole('button', { name: '영화1 조정' }));
  const [stamp] = await listQueue();
  expect(open).toHaveBeenCalledWith({ kind: 'crop', stampId: stamp.id });
});

test('cancelled share leaves the queue untouched', async () => {
  await addQueued(3);
  await saveSettings({ calibrated: true, preferredOutput: 'share' });
  const d = deps({ shareSheet: vi.fn(async () => 'cancelled' as const) });
  await setup(d);
  await clickWhenReady('시트 1 공유');
  await waitFor(() => expect(d.shareSheet).toHaveBeenCalled());
  expect(await titles()).toEqual(['영화1', '영화2', '영화3']);
  expect(await listMade()).toEqual([]);
});

test('save moves the sheet to made, and undo restores the same order', async () => {
  await addQueued(5);
  await saveSettings({ calibrated: true, preferredOutput: 'save' });
  const d = deps();
  await setup(d);
  await clickWhenReady('시트 1 저장');
  await waitFor(() => expect(d.saveSheet).toHaveBeenCalled());
  expect((d.saveSheet as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatch(/^stamps-\d{8}-\d{4}-1\.png$/);
  await waitFor(async () => expect(await titles()).toEqual(['영화4', '영화5']));
  expect(await listMade()).toHaveLength(3);

  fireEvent.click(await screen.findByRole('button', { name: '되돌리기' }));
  await waitFor(async () => expect(await titles()).toEqual(['영화1', '영화2', '영화3', '영화4', '영화5']));
  expect(await listMade()).toEqual([]);
});

test('share button is hidden when file sharing is not supported', async () => {
  await addQueued(2);
  await setup(deps({ canShareFiles: () => false }));
  expect(screen.queryByRole('button', { name: '시트 1 공유' })).toBeNull();
  expect(screen.getByRole('button', { name: '시트 1 저장' })).toBeTruthy();
});

test('uncalibrated: asks once per session, and 그냥 진행 continues the output', async () => {
  await addQueued(4);
  await saveSettings({ preferredOutput: 'save' });
  const d = deps();
  await setup(d);
  await clickWhenReady('시트 1 저장');
  expect(await screen.findByText('테스트 시트를 먼저 출력해 보세요')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '그냥 진행' }));
  await waitFor(() => expect(d.saveSheet).toHaveBeenCalledTimes(1));

  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
  await clickWhenReady('시트 1 저장');
  await waitFor(() => expect(d.saveSheet).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('테스트 시트를 먼저 출력해 보세요')).toBeNull();
  expect((await getSettings()).calibrated).toBe(false);
});

test('uncalibrated: 보정하러 가기 opens settings without output', async () => {
  await addQueued(1);
  await saveSettings({ preferredOutput: 'save' });
  const d = deps();
  const { open } = await setup(d);
  await clickWhenReady('시트 1 저장');
  fireEvent.click(await screen.findByRole('button', { name: '보정하러 가기' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith({ kind: 'settings' }));
  expect(d.saveSheet).not.toHaveBeenCalled();
});

test('after the first output it asks which method worked and remembers it', async () => {
  await addQueued(1);
  await saveSettings({ calibrated: true });
  await setup(deps());
  await clickWhenReady('시트 1 저장');
  expect(await screen.findByText('어느 방법으로 출력하셨나요?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '저장해서 출력' }));
  await waitFor(async () => expect((await getSettings()).preferredOutput).toBe('save'));
});

test('slot menu deletes after confirmation only', async () => {
  await addQueued(2);
  await setup(deps());
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: '영화1 메뉴' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '삭제' }));
  expect(await titles()).toEqual(['영화1', '영화2']);
  fireEvent.click(screen.getByRole('button', { name: '영화1 메뉴' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '삭제' }));
  await waitFor(async () => expect(await titles()).toEqual(['영화2']));
  expect(confirm).toHaveBeenCalledTimes(2);
});

test('slot menu moves a stamp later in the queue', async () => {
  await addQueued(3);
  await setup(deps());
  fireEvent.click(screen.getByRole('button', { name: '영화1 메뉴' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '뒤로 이동' }));
  await waitFor(async () => expect(await titles()).toEqual(['영화2', '영화1', '영화3']));
});

test('low resolution slot is marked', async () => {
  await addQueued(1);
  await setup(deps({ loadStampImage: vi.fn(async () => ({ width: 185, height: 278 }) as never) }));
  expect(await screen.findByLabelText('해상도 낮음')).toBeTruthy();
});

test('back closes the calibration dialog without output and without leaving', async () => {
  await addQueued(1);
  await saveSettings({ preferredOutput: 'save' });
  const d = deps();
  await setup(d);
  const pushState = vi.spyOn(history, 'pushState');
  await clickWhenReady('시트 1 저장');
  await screen.findByText('테스트 시트를 먼저 출력해 보세요');
  expect(pushState).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new PopStateEvent('popstate'));
  await waitFor(() => expect(screen.queryByText('테스트 시트를 먼저 출력해 보세요')).toBeNull());
  expect(d.saveSheet).not.toHaveBeenCalled();
  expect(await titles()).toEqual(['영화1']);
});

test('choosing in a dialog removes its history entry', async () => {
  await addQueued(1);
  await saveSettings({ preferredOutput: 'save' });
  const back = vi.spyOn(history, 'back').mockImplementation(() => window.dispatchEvent(new PopStateEvent('popstate')));
  const d = deps();
  await setup(d);
  await clickWhenReady('시트 1 저장');
  fireEvent.click(await screen.findByRole('button', { name: '그냥 진행' }));
  await waitFor(() => expect(d.saveSheet).toHaveBeenCalledTimes(1));
  expect(back).toHaveBeenCalledTimes(1);
});

test('back closes the output method question without saving a choice', async () => {
  await addQueued(1);
  await saveSettings({ calibrated: true });
  await setup(deps());
  await clickWhenReady('시트 1 저장');
  await screen.findByText('어느 방법으로 출력하셨나요?');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await waitFor(() => expect(screen.queryByText('어느 방법으로 출력하셨나요?')).toBeNull());
  expect((await getSettings()).preferredOutput).toBeUndefined();
});
