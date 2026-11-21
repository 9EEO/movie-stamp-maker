import { useEffect, useRef, useState } from 'preact/hooks';
import { DEFAULT_CROP } from '../core/crop';
import { addStamp, findByTmdbId, putBlob } from '../data/db';
import { type MovieResult, type Tmdb, type TmdbErrorKind, TmdbError, posterUrl } from '../tmdb/client';

interface Props {
  tmdb: Tmdb | null;
  onOpenSettings(): void;
  onAdded(stampId: string): void;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; results: MovieResult[]; existing: Set<number> }
  | { status: 'error'; kind: TmdbErrorKind };

const DEBOUNCE_MS = 300;

async function existingIds(results: MovieResult[]): Promise<Set<number>> {
  const found = await Promise.all(results.map(async (r) => ((await findByTmdbId(r.tmdbId)).length ? r.tmdbId : null)));
  return new Set(found.filter((id) => id !== null));
}

function ErrorMessage({ kind, onOpenSettings }: { kind: TmdbErrorKind; onOpenSettings(): void }) {
  if (kind === 'auth' || kind === 'no-key') {
    return (
      <div class="notice">
        <p>{kind === 'auth' ? 'TMDB 키가 올바르지 않아요' : 'TMDB 키를 설정하면 영화를 검색할 수 있어요'}</p>
        <button class="btn" onClick={onOpenSettings}>
          설정 열기
        </button>
      </div>
    );
  }
  return (
    <div class="notice">
      <p>{kind === 'network' ? '인터넷 연결을 확인해 주세요' : '검색 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요'}</p>
    </div>
  );
}

function UploadForm({ file, onDone }: { file: File; onDone(stampId: string | null): void }) {
  const [title, setTitle] = useState(file.name.replace(/\.[^.]+$/, ''));
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const blobId = await putBlob(file);
    const stamp = await addStamp({ source: 'upload', title: title.trim(), blobId, crop: DEFAULT_CROP });
    onDone(stamp.id);
  };
  return (
    <form class="upload-form" onSubmit={submit}>
      <label>
        제목
        <input value={title} onInput={(e) => setTitle(e.currentTarget.value)} required autoFocus />
      </label>
      <div class="row">
        <button class="btn primary" type="submit" disabled={busy || !title.trim()}>
          추가
        </button>
        <button class="btn" type="button" onClick={() => onDone(null)}>
          취소
        </button>
      </div>
    </form>
  );
}

export function Search({ tmdb, onOpenSettings, onAdded }: Props) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const [adding, setAdding] = useState(false);
  const [upload, setUpload] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!tmdb || !q) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    const h = setTimeout(async () => {
      setState({ status: 'loading' });
      try {
        const results = await tmdb.searchMovies(q);
        const existing = await existingIds(results);
        if (!cancelled) setState({ status: 'done', results, existing });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', kind: e instanceof TmdbError ? e.kind : 'http' });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [query, tmdb]);

  const add = async (r: MovieResult) => {
    if (!r.posterPath || adding) return;
    setAdding(true);
    try {
      const stamp = await addStamp({
        source: 'tmdb',
        tmdbId: r.tmdbId,
        title: r.title,
        year: r.year,
        posterPath: r.posterPath,
        crop: DEFAULT_CROP,
      });
      setQuery('');
      onAdded(stamp.id);
    } finally {
      setAdding(false);
    }
  };

  return (
    <section class="search" aria-label="영화 검색">
      <div class="search-bar">
        <input
          type="search"
          class="search-input"
          placeholder="영화 제목 검색"
          value={query}
          disabled={!tmdb}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <button class="btn" onClick={() => fileInput.current?.click()}>
          📷 내 사진
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) setUpload(file);
          }}
        />
      </div>

      {upload && (
        <UploadForm
          file={upload}
          onDone={(id) => {
            setUpload(null);
            if (id) onAdded(id);
          }}
        />
      )}

      {!tmdb && <ErrorMessage kind="no-key" onOpenSettings={onOpenSettings} />}
      {state.status === 'error' && <ErrorMessage kind={state.kind} onOpenSettings={onOpenSettings} />}
      {state.status === 'loading' && <p class="muted">검색 중…</p>}
      {state.status === 'done' && state.results.length === 0 && <p class="muted">검색 결과가 없어요</p>}
      {state.status === 'done' && state.results.length > 0 && (
        <ul class="results">
          {state.results.map((r) => (
            <li key={r.tmdbId}>
              <button class="result" disabled={!r.posterPath || adding} onClick={() => add(r)}>
                {r.posterPath ? (
                  <img class="result-thumb" src={posterUrl(r.posterPath, 'w185')} alt="" loading="lazy" />
                ) : (
                  <span class="result-thumb no-poster">포스터 없음</span>
                )}
                <span class="result-text">
                  <span class="result-title">{r.title}</span>
                  {r.year && <span class="result-year">{r.year}</span>}
                </span>
                {state.existing.has(r.tmdbId) && <span class="badge">이미 있음</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
