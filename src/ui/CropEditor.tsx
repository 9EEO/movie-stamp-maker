import { useEffect, useRef, useState } from 'preact/hooks';
import { BLEED_RECT, type Crop, DEFAULT_CROP, clampCrop, isLowRes, placeImage } from '../core/crop';
import { STAMP_H_MM, STAMP_W_MM } from '../core/layout';
import { type Stamp, getStamp, updateStamp } from '../data/db';
import { type ImageLike, loadStampImage as defaultLoad } from '../platform/image';
import { posterUrl } from '../tmdb/client';
import { useApp } from './context';
import { OverlayFrame } from './OverlayFrame';

export type { ImageLike } from '../platform/image';

interface Props {
  stampId: string;
  onDone(): void;
  loadStampImage?: (stamp: Stamp) => Promise<ImageLike>;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

/** 무대(stage) 안에서 칼선 틀의 위치. k = 화면 px / mm */
function frameLayout(stageW: number, stageH: number) {
  const fw = Math.min(stageW * 0.8, stageH * 0.85 * (STAMP_W_MM / STAMP_H_MM));
  const fh = fw * (STAMP_H_MM / STAMP_W_MM);
  return { k: fw / STAMP_W_MM, fx: (stageW - fw) / 2, fy: (stageH - fh) / 2 };
}

function draw(canvas: HTMLCanvasElement, img: ImageLike, crop: Crop, w: number, h: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { k, fx, fy } = frameLayout(w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1d1916';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 이후 좌표는 세로 우표 좌표계(mm), 원점 = 칼선 왼쪽 위
  ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * fx, dpr * fy);
  ctx.fillStyle = '#fff';
  ctx.fillRect(BLEED_RECT.xMm, BLEED_RECT.yMm, BLEED_RECT.wMm, BLEED_RECT.hMm);
  const r = placeImage(img.width, img.height, crop);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, r.xMm, r.yMm, r.wMm, r.hMm);

  // 칼선 바깥은 어둡게
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.beginPath();
  ctx.rect(-1e4, -1e4, 2e4, 2e4);
  ctx.rect(0, 0, STAMP_W_MM, STAMP_H_MM);
  ctx.fill('evenodd');

  // 번짐 영역은 점선, 칼선은 실선
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1 / k;
  ctx.setLineDash([4 / k, 3 / k]);
  ctx.strokeRect(BLEED_RECT.xMm, BLEED_RECT.yMm, BLEED_RECT.wMm, BLEED_RECT.hMm);
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5 / k;
  ctx.strokeRect(0, 0, STAMP_W_MM, STAMP_H_MM);
}

export function CropEditor({ stampId, onDone, loadStampImage = defaultLoad }: Props) {
  const { tmdb } = useApp();
  const [stamp, setStamp] = useState<Stamp | null>(null);
  const [posterPath, setPosterPath] = useState<string | undefined>();
  const [crop, setCrop] = useState<Crop>(DEFAULT_CROP);
  const [img, setImg] = useState<ImageLike | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [posters, setPosters] = useState<string[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<ImageLike | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  imgRef.current = img;

  useEffect(() => {
    getStamp(stampId).then((s) => {
      if (!s) return;
      setStamp(s);
      setPosterPath(s.posterPath);
      setCrop(s.crop);
    });
  }, [stampId]);

  useEffect(() => {
    if (!stamp) return;
    let cancelled = false;
    setImg(null);
    setLoadError(false);
    loadStampImage({ ...stamp, posterPath })
      .then((i) => {
        if (cancelled) return;
        setImg(i);
        setCrop((c) => clampCrop(i.width, i.height, c));
      })
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [stamp, posterPath, loadStampImage]);

  useEffect(() => {
    if (stamp?.source !== 'tmdb' || stamp.tmdbId === undefined || !tmdb) return;
    tmdb
      .listPosters(stamp.tmdbId)
      .then(setPosters)
      .catch(() => setPosters([]));
  }, [stamp, tmdb]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (canvasRef.current && img && size.w > 0) draw(canvasRef.current, img, crop, size.w, size.h);
  }, [img, crop, size]);

  const update = (fn: (c: Crop) => Crop) => {
    setCrop((c) => {
      const next = fn(c);
      const i = imgRef.current;
      return i ? clampCrop(i.width, i.height, next) : next;
    });
  };

  /** 화면 1px이 몇 mm인지 */
  const mmPerPx = () => {
    const r = stageRef.current?.getBoundingClientRect();
    const { k } = frameLayout(r?.width ?? 0, r?.height ?? 0);
    return k > 0 ? 1 / k : 1;
  };

  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: PointerEvent) => {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    const i = imgRef.current;
    if (!prev || !i) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (map.size === 1) {
      const s = mmPerPx();
      const dx = (cur.x - prev.x) * s;
      const dy = (cur.y - prev.y) * s;
      update((c) => {
        const r = placeImage(i.width, i.height, c);
        return { ...c, cx: c.cx - dx / r.wMm, cy: c.cy - dy / r.hMm };
      });
    } else if (map.size === 2) {
      const other = [...map.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(cur.x - other.x, cur.y - other.y);
        if (before > 0) update((c) => ({ ...c, zoom: c.zoom * (after / before) }));
      }
    }
    map.set(e.pointerId, cur);
  };

  const onPointerEnd = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    update((c) => ({ ...c, zoom: c.zoom * Math.exp(-e.deltaY * 0.002) }));
  };

  const setMode = (mode: Crop['mode']) => setCrop({ mode, cx: 0.5, cy: 0.5, zoom: 1 });

  const choosePoster = (path: string) => {
    if (path === posterPath) return;
    setPosterPath(path);
    setCrop(DEFAULT_CROP);
  };

  const done = async () => {
    if (saving) return;
    setSaving(true);
    await updateStamp(stampId, { crop, posterPath });
    onDone();
  };

  const lowRes = img ? isLowRes(img.width, img.height, crop) : false;

  return (
    <OverlayFrame
      title="우표 조정"
      class="crop-overlay"
      actions={
        <button class="btn primary" onClick={done} disabled={saving || !stamp}>
          완료
        </button>
      }
    >
      <div class="crop-editor">
        <div
          ref={stageRef}
          class="crop-stage"
          aria-label="포스터 위치 조정"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onWheel={onWheel}
        >
          <canvas ref={canvasRef} class="crop-canvas" />
          {!img && !loadError && <p class="crop-status">불러오는 중…</p>}
          {loadError && <p class="crop-status">이미지를 불러올 수 없어요</p>}
        </div>

        {lowRes && (
          <p class="warning" role="alert">
            해상도가 낮아 흐리게 나올 수 있어요
          </p>
        )}

        <div class="segmented" role="group" aria-label="맞춤 방식">
          <button aria-pressed={crop.mode === 'fill'} onClick={() => setMode('fill')}>
            꽉 채우기
          </button>
          <button aria-pressed={crop.mode === 'fit'} onClick={() => setMode('fit')}>
            전체 보이기
          </button>
        </div>

        <label class="zoom-row">
          <span>확대</span>
          <input
            type="range"
            aria-label="확대"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onInput={(e) => {
              const zoom = Number(e.currentTarget.value);
              update((c) => ({ ...c, zoom }));
            }}
          />
        </label>

        {posters.length > 1 && (
          <div class="poster-strip" role="group" aria-label="다른 포스터">
            {posters.map((p, i) => (
              <button
                key={p}
                class="poster-choice"
                aria-label={`포스터 ${i + 1}`}
                aria-pressed={p === posterPath}
                onClick={() => choosePoster(p)}
              >
                <img src={posterUrl(p, 'w185')} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
    </OverlayFrame>
  );
}
