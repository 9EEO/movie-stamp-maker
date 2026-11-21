import { useEffect, useRef, useState } from 'preact/hooks';
import { DEFAULT_CROP } from '../core/crop';
import { addStamp, findByTmdbId, putBlob } from '../data/db';
import { prepareUpload } from '../platform/image';
import { type MovieResult, type Tmdb, type TmdbErrorKind, TmdbError, posterUrl } from '../tmdb/client';

interface Props {
  tmdb: Tmdb | null;
  onOpenSettings(): void;
  onAdded(stampId: string): void;
  /** 사진 여러 장을 한 번에 담았을 때 */
  onAddedMany?(added: number, skipped: number, storageFailed: boolean): void;
  prepareUpload?(file: Blob): Promise<Blob>;
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

interface PendingPhoto {
  key: number;
  file: File;
  title: string;
}

const titleFromName = (name: string) => name.replace(/\.[^.]+$/, '');

/** 고른 사진마다 작은 미리보기 주소. 화면을 떠나면 해제한다 */
function usePreviewUrls(files: File[]): Map<File, string> {
  const [urls, setUrls] = useState(new Map<File, string>());
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return;
    const map = new Map(files.map((f) => [f, URL.createObjectURL(f)]));
    setUrls(map);
    return () => map.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return urls;
}

interface UploadFormProps {
  files: File[];
  prepare(file: Blob): Promise<Blob>;
  onCancel(): void;
  /** 한 장만 담았을 때: 바로 조정 화면을 연다 */
  onSingle(stampId: string): void;
  /** 여러 장을 담았을 때 */
  onMany(added: number, skipped: number, storageFailed: boolean): void;
}

function UploadForm({ files, prepare, onCancel, onSingle, onMany }: UploadFormProps) {
  const [items, setItems] = useState<PendingPhoto[]>(() =>
    files.map((file, key) => ({ key, file, title: titleFromName(file.name) })),
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const previews = usePreviewUrls(files);

  const save = async (blob: Blob, title: string) => {
    const blobId = await putBlob(blob);
    return addStamp({ source: 'upload', title: title.trim(), blobId, crop: DEFAULT_CROP });
  };

  const submitOne = async (item: PendingPhoto) => {
    let blob: Blob;
    try {
      blob = await prepare(item.file);
    } catch {
      setError('이 사진을 열 수 없어요. JPG나 PNG로 다시 골라 주세요');
      setBusy(false);
      return;
    }
    try {
      onSingle((await save(blob, item.title)).id);
    } catch {
      setError('사진을 저장하지 못했어요. 저장 공간을 확인해 주세요');
      setBusy(false);
    }
  };

  // 한 장씩 차례로 열고 줄여 저장한다(한꺼번에 열면 폰 메모리가 모자랄 수 있다)
  const submitMany = async () => {
    let added = 0;
    let skipped = 0;
    for (const item of items) {
      setProgress(added + skipped + 1);
      let blob: Blob;
      try {
        blob = await prepare(item.file);
      } catch {
        skipped++;
        continue;
      }
      try {
        await save(blob, item.title);
        added++;
      } catch {
        onMany(added, skipped, true);
        return;
      }
    }
    onMany(added, skipped, false);
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy || items.length === 0 || items.some((i) => !i.title.trim())) return;
    setBusy(true);
    setError(null);
    if (items.length === 1) await submitOne(items[0]);
    else await submitMany();
  };

  const setTitle = (key: number, title: string) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, title } : i)));

  const remove = (key: number) => {
    const next = items.filter((i) => i.key !== key);
    if (next.length === 0) onCancel();
    else setItems(next);
  };

  const many = items.length > 1;
  const canSubmit = !busy && items.every((i) => i.title.trim());

  return (
    <form class="upload-form" onSubmit={submit}>
      {many ? (
        <ul class="upload-list">
          {items.map((item, i) => (
            <li key={item.key} class="upload-item">
              {previews.get(item.file) ? (
                <img class="upload-thumb" src={previews.get(item.file)} alt="" />
              ) : (
                <span class="upload-thumb" />
              )}
              <input
                aria-label={`${i + 1}번 사진 제목`}
                value={item.title}
                disabled={busy}
                onInput={(e) => setTitle(item.key, e.currentTarget.value)}
              />
              <button
                type="button"
                class="icon-btn"
                aria-label={`${item.title || `${i + 1}번 사진`} 목록에서 빼기`}
                disabled={busy}
                onClick={() => remove(item.key)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <label>
          제목
          <input
            value={items[0].title}
            onInput={(e) => setTitle(items[0].key, e.currentTarget.value)}
            required
            autoFocus
          />
        </label>
      )}
      {many && <p class="muted small">위치는 기본값(꽉 채우기·가운데)으로 담겨요. 대기열에서 칸을 눌러 고칠 수 있어요.</p>}
      <div class="row">
        <button class="btn primary" type="submit" disabled={!canSubmit}>
          {busy && many ? `담는 중… ${progress}/${items.length}` : many ? `${items.length}장 모두 추가` : '추가'}
        </button>
        <button class="btn" type="button" disabled={busy} onClick={onCancel}>
          취소
        </button>
      </div>
      {error && (
        <p class="note error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function Search({ tmdb, onOpenSettings, onAdded, onAddedMany, prepareUpload: prepare = prepareUpload }: Props) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const [adding, setAdding] = useState(false);
  const [uploads, setUploads] = useState<File[] | null>(null);
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
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = '';
            if (files.length) setUploads(files);
          }}
        />
      </div>

      {uploads && (
        <UploadForm
          key={uploads.map((f) => f.name).join('|')}
          files={uploads}
          prepare={prepare}
          onCancel={() => setUploads(null)}
          onSingle={(id) => {
            setUploads(null);
            onAdded(id);
          }}
          onMany={(added, skipped, storageFailed) => {
            setUploads(null);
            onAddedMany?.(added, skipped, storageFailed);
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
                  <img class="result-thumb" src={posterUrl(r.posterPath, 'w185')} alt="" loading="lazy" crossOrigin="anonymous" />
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
