import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { closeDb, getSettings, saveSettings } from '../../src/data/db';
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

test('home credits TMDB with its logo and the notice its API terms require', async () => {
  render(<App />);
  const credit = await screen.findByRole('contentinfo');
  const logo = credit.querySelector('img');
  expect(logo?.getAttribute('alt')).toBe('TMDB');
  expect(logo?.getAttribute('src')).toMatch(/tmdb-logo\.svg$/);
  expect(credit.textContent).toContain(
    'This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.',
  );
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

test('settings overlay shows the real settings screen', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: '설정' }));
  expect(await screen.findByRole('region', { name: '출력 보정' })).toBeTruthy();
});

test('asks the browser to persist storage on start', async () => {
  const persist = vi.fn(async () => true);
  Object.defineProperty(navigator, 'storage', { value: { persist }, configurable: true });
  render(<App />);
  await waitFor(() => expect(persist).toHaveBeenCalled());
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
});

function installPromptEvent() {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  e.prompt = vi.fn(async () => {});
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  return e;
}

test('install banner shows once and is remembered', async () => {
  render(<App />);
  await screen.findByRole('heading', { name: '내 우표 컬렉션' });
  const e = installPromptEvent();
  window.dispatchEvent(e);
  expect(await screen.findByText('홈 화면에 추가하면 앱처럼 쓸 수 있고 데이터도 안전해요')).toBeTruthy();
  await waitFor(async () => expect((await getSettings()).installPrompted).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: '홈 화면에 추가' }));
  expect(e.prompt).toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByText('홈 화면에 추가하면 앱처럼 쓸 수 있고 데이터도 안전해요')).toBeNull());
});

test('install banner does not show again after it was prompted', async () => {
  await saveSettings({ installPrompted: true });
  render(<App />);
  await screen.findByRole('heading', { name: '내 우표 컬렉션' });
  await waitFor(async () => expect((await getSettings()).installPrompted).toBe(true));
  window.dispatchEvent(installPromptEvent());
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByText('홈 화면에 추가하면 앱처럼 쓸 수 있고 데이터도 안전해요')).toBeNull();
});

test('re-rendering the app does not repeat a finished search', async () => {
  await saveSettings({ tmdbKey: 'k' });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/search/movie')) {
      return new Response(JSON.stringify({ results: [{ id: 1, title: '영화', release_date: '2001-01-01', poster_path: null }] }));
    }
    throw new TypeError('offline');
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  fireEvent.input(await screen.findByRole('searchbox'), { target: { value: '영화' } });
  await screen.findByText('포스터 없음');
  const searches = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/search/movie')).length;
  expect(searches()).toBe(1);
  // 설정을 열고 닫으면 App이 다시 그려진다
  fireEvent.click(screen.getByRole('button', { name: '설정' }));
  await screen.findByRole('dialog', { name: '설정' });
  popstate();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await new Promise((r) => setTimeout(r, 400));
  expect(searches()).toBe(1);
});

test('closing an overlay with its button goes back in history', async () => {
  const back = vi.spyOn(history, 'back').mockImplementation(() => popstate());
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: '설정' }));
  fireEvent.click(await screen.findByRole('button', { name: '닫기' }));
  expect(back).toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
