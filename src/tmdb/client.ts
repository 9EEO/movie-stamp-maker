export interface MovieResult {
  tmdbId: number;
  title: string;
  year?: number;
  posterPath: string | null;
}

export type TmdbErrorKind = 'no-key' | 'auth' | 'network' | 'http';

export class TmdbError extends Error {
  constructor(
    readonly kind: TmdbErrorKind,
    message: string = kind,
  ) {
    super(message);
    this.name = 'TmdbError';
  }
}

const API = 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p';

interface SearchResponse {
  results: { id: number; title: string; release_date?: string; poster_path: string | null }[];
}

interface ImagesResponse {
  posters: { file_path: string }[];
}

function yearOf(releaseDate?: string): number | undefined {
  const year = Number(releaseDate?.slice(0, 4));
  return releaseDate && Number.isInteger(year) && year > 0 ? year : undefined;
}

/** v4 읽기 토큰(eyJ…)은 Authorization 헤더로, v3 키는 api_key 쿼리로 보낸다. */
export function createTmdb(key: string, fetchFn: typeof fetch = (...args) => fetch(...args)) {
  const trimmed = key.trim();
  const isV4 = trimmed.startsWith('eyJ');

  async function get<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!trimmed) throw new TmdbError('no-key');
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (!isV4) url.searchParams.set('api_key', trimmed);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (isV4) headers.Authorization = `Bearer ${trimmed}`;
    let res: Response;
    try {
      res = await fetchFn(url.toString(), { headers });
    } catch {
      throw new TmdbError('network');
    }
    if (res.status === 401) throw new TmdbError('auth');
    if (!res.ok) throw new TmdbError('http', `HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async searchMovies(query: string): Promise<MovieResult[]> {
      const data = await get<SearchResponse>('/search/movie', {
        query,
        language: 'ko-KR',
        include_adult: 'false',
      });
      return data.results.map((r) => ({
        tmdbId: r.id,
        title: r.title,
        year: yearOf(r.release_date),
        posterPath: r.poster_path ?? null,
      }));
    },

    async listPosters(tmdbId: number): Promise<string[]> {
      const data = await get<ImagesResponse>(`/movie/${tmdbId}/images`, { include_image_language: 'ko,en,null' });
      return data.posters.map((p) => p.file_path);
    },
  };
}

export type Tmdb = ReturnType<typeof createTmdb>;

export function posterUrl(path: string, size: 'w185' | 'w780' | 'original'): string {
  return `${IMAGE}/${size}${path}`;
}
