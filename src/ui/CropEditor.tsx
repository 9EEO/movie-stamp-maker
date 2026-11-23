import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BLEED_RECT, type Crop, DEFAULT_CROP, clampCrop, imagePointAt, isLowRes, placeImage } from '../core/crop';
import { STAMP_H_MM, STAMP_W_MM } from '../core/layout';
import { type Pixels, colorAt, dominantColors, edgeColor, marginSides } from '../core/palette';
import { type Stamp, getStamp, updateStamp } from '../data/db';
import { type ImageLike, loadStampImage as defaultLoad, samplePixels as readPixels } from '../platform/image';
import { posterUrl } from '../tmdb/client';
import { useApp } from './context';
import { OverlayFrame } from './OverlayFrame';

export type { ImageLike } from '../platform/image';

interface Props {
  stampId: string;
  onDone(): void;
  loadStampImage?: (stamp: Stamp) => Promise<ImageLike>;
  /** 추천 색과 스포이드에 쓸 픽셀. 읽을 수 없으면 null */
  samplePixels?: (img: ImageLike) => Pixels | null;
}

const WHITE = '#ffffff';
const defaultSample = (img: ImageLike) => readPixels(img, 160);

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

/** 무대(stage) 안에서 칼선 틀의 위치. k = 화면 px / mm */
export function frameLayout(stageW: number, stageH: number) {
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
  ctx.fillStyle = crop.bg ?? WHITE;
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

export function CropEditor({ stampId, onDone, loadStampImage = defaultLoad, samplePixels = defaultSample }: Props) {
  const { tmdb } = useApp();
  const [stamp, setStamp] = useState<Stamp | null>(null);
  const [posterPath, setPosterPath] = useState<string | undefined>();
  const [crop, setCrop] = useState<Crop>(DEFAULT_CROP);
  const [img, setImg] = useState<ImageLike | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [posters, setPosters] = useState<string[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

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

  const pixels = useMemo(() => (img ? samplePixels(img) : null), [img, samplePixels]);
  // 여백 추천 색: 여백이 닿는 가장자리 색, 그리고 포스터에서 많이 쓰인 색
  const suggestions = useMemo(() => {
    if (!img || !pixels) return null;
    const edge = edgeColor(pixels, marginSides(img.width, img.height));
    return { edge, palette: dominantColors(pixels, 3, [WHITE, edge]) };
  }, [img, pixels]);

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

  const setBg = (bg: string) => setCrop((c) => ({ ...c, bg }));

  /** 스포이드: 탭한 곳이 포스터 위면 그 색을 여백 색으로 */
  const pick = (e: PointerEvent) => {
    const rect = stageRef.current?.getBoundingClientRect();
    const i = imgRef.current;
    if (!rect || !i || !pixels) return;
    const { k, fx, fy } = frameLayout(rect.width, rect.height);
    if (k <= 0) return;
    const p = imagePointAt(i.width, i.height, crop, (e.clientX - rect.left - fx) / k, (e.clientY - rect.top - fy) / k);
    if (!p) return;
    setBg(colorAt(pixels, p.u, p.v));
    setPicking(false);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (picking) {
      pick(e);
      return;
    }
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
    if (picking) return;
    update((c) => ({ ...c, zoom: c.zoom * Math.exp(-e.deltaY * 0.002) }));
  };

  // 위치는 처음으로 되돌리되 고른 여백 색은 남긴다. 여백 색이 없을 때 전체 보이기로 바꾸면 가장자리 색을 넣는다
  const setMode = (mode: Crop['mode']) => {
    setPicking(false);
    setCrop((c) => {
      const bg = c.bg ?? (mode === 'fit' ? suggestions?.edge : undefined);
      return { mode, cx: 0.5, cy: 0.5, zoom: 1, ...(bg ? { bg } : {}) };
    });
  };

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
  const currentBg = crop.bg ?? WHITE;
  const swatches = [
    { label: '흰색', color: WHITE },
    ...(suggestions
      ? [
          { label: '가장자리 색', color: suggestions.edge },
          ...suggestions.palette.map((color, i) => ({ label: `포스터 색 ${i + 1}`, color })),
        ]
      : []),
  ];

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
          {picking && <p class="crop-hint">포스터를 눌러 색을 고르세요</p>}
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

        {crop.mode === 'fit' && (
          <div class="margin-row" role="group" aria-label="여백 색">
            <span class="margin-label">여백</span>
            {swatches.map(({ label, color }) => (
              <button
                key={label}
                class="swatch"
                aria-label={label}
                title={label}
                aria-pressed={currentBg === color}
                style={{ background: color }}
                onClick={() => setBg(color)}
              />
            ))}
            {pixels && (
              <button
                class="swatch-tool"
                aria-label="스포이드"
                title="스포이드"
                aria-pressed={picking}
                onClick={() => setPicking((p) => !p)}
              >
                🎯
              </button>
            )}
            <label class="swatch-tool" title="직접 고르기">
              🎨
              <input
                type="color"
                aria-label="직접 고르기"
                value={currentBg}
                onInput={(e) => setBg(e.currentTarget.value)}
              />
            </label>
          </div>
        )}

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
                <img src={posterUrl(p, 'w185')} alt="" loading="lazy" crossOrigin="anonymous" />
              </button>
            ))}
          </div>
        )}
      </div>
    </OverlayFrame>
  );
}
