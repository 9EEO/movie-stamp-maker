import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { closeDb, saveSettings } from '../../src/data/db';
import type { Tmdb } from '../../src/tmdb/client';
import { App } from '../../src/ui/App';
import { resetDb } from '../helpers/resetDb';

beforeEach(async () => {
  await resetDb();
  // 조정 화면이 포스터를 받으려 할 때 실제 네트워크로 나가지 않게 한다
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(closeDb);

const fakeTmdb: Tmdb = {
  searchMovies: async () => [{ tmdbId: 129, title: '센과 치히로의 행방불명', year: 2001, posterPath: '/abc.jpg' }],
  listPosters: async () => [],
};

function popstate() {
  window.dispatchEvent(new PopStateEvent('popstate'));
}

test('home shows title, settings button and sections', async () => {
  render(<App />);
  expect(await screen.findByRole('heading', { name: '내 우표 컬렉션' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '설정' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '출력 대기' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '만든 우표' })).toBeTruthy();
});

test('adding a search result opens the crop overlay, and back closes only the overlay', async () => {
  await saveSettings({ tmdbKey: 'k' });
  const pushState = vi.spyOn(history, 'pushState');
  render(<App makeTmdb={() => fakeTmdb} />);
  fireEvent.input(await screen.findByRole('searchbox'), { target: { value: '치히로' } });
  fireEvent.click((await screen.findByText('센과 치히로의 행방불명')).closest('button')!);
  expect(await screen.findByRole('dialog', { name: '우표 조정' })).toBeTruthy();
  expect(pushState).toHaveBeenCalledTimes(1);

  popstate();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('heading', { name: '내 우표 컬렉션' })).toBeTruthy();
});

test('back closes the top overlay only', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: '설정' }));
  expect(await screen.findByRole('dialog', { name: '설정' })).toBeTruthy();
  popstate();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  // 오버레이가 없을 때 뒤로가기는 아무것도 닫지 않는다(홈 유지)
  popstate();
  expect(screen.getByRole('heading', { name: '내 우표 컬렉션' })).toBeTruthy();
});

test('closing an overlay with its button goes back in history', async () => {
  const back = vi.spyOn(history, 'back').mockImplementation(() => popstate());
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: '설정' }));
  fireEvent.click(await screen.findByRole('button', { name: '닫기' }));
  expect(back).toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
