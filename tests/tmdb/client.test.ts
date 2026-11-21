import { TmdbError, createTmdb, posterUrl } from '../../src/tmdb/client';

interface Recorded {
  url: URL;
  headers: Record<string, string>;
}

function fakeFetch(respond: (url: URL) => { status?: number; body?: unknown } | Error) {
  const calls: Recorded[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const r = respond(url);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const searchBody = {
  results: [
    { id: 129, title: '센과 치히로의 행방불명', release_date: '2001-07-20', poster_path: '/abc.jpg' },
    { id: 7, title: '포스터 없는 영화', release_date: '', poster_path: null },
  ],
};

test('v3 key goes in the api_key query', async () => {
  const f = fakeFetch(() => ({ body: searchBody }));
  await createTmdb('v3key123', f.fn).searchMovies('치히로');
  expect(f.calls[0].url.searchParams.get('api_key')).toBe('v3key123');
  expect(f.calls[0].headers.Authorization).toBeUndefined();
});

test('v4 token goes in the Authorization header', async () => {
  const f = fakeFetch(() => ({ body: searchBody }));
  await createTmdb('eyJhbGciOi.token', f.fn).searchMovies('치히로');
  expect(f.calls[0].headers.Authorization).toBe('Bearer eyJhbGciOi.token');
  expect(f.calls[0].url.searchParams.has('api_key')).toBe(false);
});

test('searchMovies calls search/movie in Korean without adult results', async () => {
  const f = fakeFetch(() => ({ body: searchBody }));
  await createTmdb('k', f.fn).searchMovies('센과 치히로');
  const { url } = f.calls[0];
  expect(url.origin + url.pathname).toBe('https://api.themoviedb.org/3/search/movie');
  expect(url.searchParams.get('query')).toBe('센과 치히로');
  expect(url.searchParams.get('language')).toBe('ko-KR');
  expect(url.searchParams.get('include_adult')).toBe('false');
});

test('searchMovies maps results, year and missing poster', async () => {
  const f = fakeFetch(() => ({ body: searchBody }));
  expect(await createTmdb('k', f.fn).searchMovies('x')).toEqual([
    { tmdbId: 129, title: '센과 치히로의 행방불명', year: 2001, posterPath: '/abc.jpg' },
    { tmdbId: 7, title: '포스터 없는 영화', year: undefined, posterPath: null },
  ]);
});

test('401 is an auth error', async () => {
  const f = fakeFetch(() => ({ status: 401, body: { status_message: 'Invalid API key' } }));
  await expect(createTmdb('bad', f.fn).searchMovies('x')).rejects.toMatchObject({ kind: 'auth' });
  await expect(createTmdb('bad', f.fn).searchMovies('x')).rejects.toBeInstanceOf(TmdbError);
});

test('other failing status is an http error', async () => {
  const f = fakeFetch(() => ({ status: 500 }));
  await expect(createTmdb('k', f.fn).searchMovies('x')).rejects.toMatchObject({ kind: 'http' });
});

test('rejected fetch is a network error', async () => {
  const f = fakeFetch(() => new TypeError('Failed to fetch'));
  await expect(createTmdb('k', f.fn).searchMovies('x')).rejects.toMatchObject({ kind: 'network' });
});

test('empty key is a no-key error without calling fetch', async () => {
  const f = fakeFetch(() => ({ body: searchBody }));
  for (const key of ['', '   ']) {
    await expect(createTmdb(key, f.fn).searchMovies('x')).rejects.toMatchObject({ kind: 'no-key' });
    await expect(createTmdb(key, f.fn).listPosters(1)).rejects.toMatchObject({ kind: 'no-key' });
  }
  expect(f.calls).toHaveLength(0);
});

test('listPosters returns file paths in Korean, English and no-language', async () => {
  const f = fakeFetch(() => ({ body: { posters: [{ file_path: '/p1.jpg' }, { file_path: '/p2.jpg' }] } }));
  expect(await createTmdb('k', f.fn).listPosters(129)).toEqual(['/p1.jpg', '/p2.jpg']);
  const { url } = f.calls[0];
  expect(url.origin + url.pathname).toBe('https://api.themoviedb.org/3/movie/129/images');
  expect(url.searchParams.get('include_image_language')).toBe('ko,en,null');
});

test('posterUrl', () => {
  expect(posterUrl('/abc.jpg', 'w780')).toBe('https://image.tmdb.org/t/p/w780/abc.jpg');
  expect(posterUrl('/abc.jpg', 'w185')).toBe('https://image.tmdb.org/t/p/w185/abc.jpg');
});
