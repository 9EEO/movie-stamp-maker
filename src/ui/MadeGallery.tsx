import { useEffect, useState } from 'preact/hooks';
import {
  type Stamp,
  addStamp,
  deleteStamp,
  getBlob,
  getStamp,
  listMade,
  putBlob,
  returnToQueue,
} from '../data/db';
import { posterUrl } from '../tmdb/client';
import { useConfirm } from './ConfirmDialog';
import { useApp } from './context';
import { OverlayFrame } from './OverlayFrame';
import { StampThumb } from './StampThumb';
import { showToast } from './Toast';

/** 썸네일 주소: TMDB 포스터는 지정한 크기, 직접 올린 사진은 objectURL */
function useStampSrc(stamp: Stamp | null, size: 'w185' | 'w780'): string | undefined {
  const [blobUrl, setBlobUrl] = useState<string>();
  const blobId = stamp?.source === 'upload' ? stamp.blobId : undefined;
  useEffect(() => {
    if (!blobId || typeof URL.createObjectURL !== 'function') return;
    let url: string | undefined;
    let cancelled = false;
    getBlob(blobId).then((blob) => {
      if (!blob || cancelled) return;
      url = URL.createObjectURL(blob);
      setBlobUrl(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blobId]);
  if (!stamp) return undefined;
  if (stamp.source === 'tmdb') return stamp.posterPath ? posterUrl(stamp.posterPath, size) : undefined;
  return blobUrl;
}

function GalleryItem({ stamp }: { stamp: Stamp }) {
  const { open } = useApp();
  const src = useStampSrc(stamp, 'w185');
  return (
    <li>
      <button class="gallery-item" aria-label={`${stamp.title} 보기`} onClick={() => open({ kind: 'detail', stampId: stamp.id })}>
        <StampThumb src={src} crop={stamp.crop} alt={stamp.title} />
      </button>
    </li>
  );
}

export function MadeGallery() {
  const { version } = useApp();
  const [made, setMade] = useState<Stamp[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    listMade().then(setMade);
  }, [version]);

  const q = query.trim().toLowerCase();
  const shown = made?.filter((s) => s.title.toLowerCase().includes(q)) ?? [];

  return (
    <section class="section" aria-label="만든 우표">
      <h2>만든 우표 ({made?.length ?? 0})</h2>
      {made && made.length > 0 && (
        <input
          type="search"
          class="search-input gallery-search"
          aria-label="만든 우표 제목 검색"
          placeholder="제목으로 찾기"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      )}
      {made && made.length === 0 && <p class="muted">시트를 저장하거나 공유하면 여기에 모여요</p>}
      {made && made.length > 0 && shown.length === 0 && <p class="muted">찾는 우표가 없어요</p>}
      <ul class="gallery">
        {shown.map((s) => (
          <GalleryItem key={s.id} stamp={s} />
        ))}
      </ul>
    </section>
  );
}

const formatDate = (t: number) => new Date(t).toLocaleDateString('ko-KR');

export function StampDetail({ stampId }: { stampId: string }) {
  const { close, refresh } = useApp();
  const [stamp, setStamp] = useState<Stamp | null>(null);
  const [busy, setBusy] = useState(false);
  const src = useStampSrc(stamp, 'w780');
  const [confirm, confirmDialog] = useConfirm();

  useEffect(() => {
    getStamp(stampId).then((s) => setStamp(s ?? null));
  }, [stampId]);

  const run = async (fn: (s: Stamp) => Promise<void>) => {
    if (!stamp || busy) return;
    setBusy(true);
    try {
      await fn(stamp);
    } finally {
      setBusy(false);
    }
  };

  const remake = (s: Stamp) =>
    run(async () => {
      // 원본을 지워도 사본이 남도록 올린 사진은 Blob을 따로 복사한다
      const blob = s.blobId ? await getBlob(s.blobId) : undefined;
      await addStamp({
        source: s.source,
        tmdbId: s.tmdbId,
        title: s.title,
        year: s.year,
        posterPath: s.posterPath,
        blobId: blob ? await putBlob(blob) : undefined,
        crop: s.crop,
      });
      refresh();
      showToast('대기열에 담았어요');
      close();
    });

  const backToQueue = (s: Stamp) =>
    run(async () => {
      await returnToQueue(s.id);
      refresh();
      showToast('대기열로 되돌렸어요');
      close();
    });

  const remove = (s: Stamp) =>
    run(async () => {
      if (!(await confirm(`'${s.title}' 우표를 지울까요? 되돌릴 수 없어요.`, '지우기'))) return;
      await deleteStamp(s.id);
      refresh();
      close();
    });

  return (
    <OverlayFrame title="우표 정보">
      {stamp && (
        <div class="detail">
          <div class="detail-stamp">
            <StampThumb src={src} crop={stamp.crop} alt={stamp.title} />
          </div>
          <h3 class="detail-title">{stamp.title}</h3>
          <dl class="detail-meta">
            {stamp.year && (
              <>
                <dt>개봉</dt>
                <dd>{stamp.year}</dd>
              </>
            )}
            {stamp.madeAt && (
              <>
                <dt>만든 날짜</dt>
                <dd>{formatDate(stamp.madeAt)}</dd>
              </>
            )}
          </dl>
          <div class="detail-actions">
            <button class="btn primary" disabled={busy} onClick={() => remake(stamp)}>
              다시 만들기
            </button>
            {stamp.status === 'made' && (
              <button class="btn" disabled={busy} onClick={() => backToQueue(stamp)}>
                대기열로 되돌리기
              </button>
            )}
            <button class="btn danger" disabled={busy} onClick={() => remove(stamp)}>
              삭제
            </button>
          </div>
        </div>
      )}
      {confirmDialog}
    </OverlayFrame>
  );
}
