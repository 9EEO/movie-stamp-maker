import { useEffect, useRef, useState } from 'preact/hooks';
import { type Calibration, DEFAULT_CALIBRATION } from '../core/calibration';
import { isLowRes } from '../core/crop';
import { PAPER_MM, SLOTS } from '../core/layout';
import { type SheetEntry, chunkIntoSheets, paintSheet, renderToBlob } from '../core/sheet';
import {
  type Stamp,
  deleteStamp,
  listQueue,
  markMade,
  reorderQueue,
  returnToQueue,
  saveSettings,
} from '../data/db';
import { type ImageLike, loadStampImage } from '../platform/image';
import { canShareFiles, saveSheet, shareSheet, sheetFileName } from '../platform/output';
import { useApp } from './context';
import { showToast } from './Toast';

/** 화면 밖 동작(이미지·캔버스·공유)을 바꿔 끼울 수 있게 모은 것 */
export interface QueueDeps {
  loadStampImage(stamp: Stamp): Promise<ImageLike>;
  drawPreview(canvas: HTMLCanvasElement, entries: (SheetEntry | null)[], cal: Calibration): void;
  renderSheet(entries: (SheetEntry | null)[], cal: Calibration): Promise<Blob>;
  canShareFiles(): boolean;
  shareSheet(blob: Blob, name: string): Promise<'shared' | 'cancelled'>;
  saveSheet(blob: Blob, name: string): void;
}

const defaultDeps: QueueDeps = {
  loadStampImage,
  drawPreview(canvas, entries, cal) {
    const ctx = canvas.getContext('2d');
    if (ctx) paintSheet(ctx, entries, cal);
  },
  renderSheet: (entries, cal) => renderToBlob((ctx) => paintSheet(ctx, entries, cal)),
  canShareFiles,
  shareSheet,
  saveSheet,
};

type Loaded = { img: ImageLike } | { error: true };

const imageKey = (s: Stamp) => `${s.id}:${s.posterPath ?? s.blobId ?? ''}`;

/** 보정 안내는 세션 동안 한 번만 */
const CALIBRATION_ASKED = 'calibration-asked';
function calibrationAsked(): boolean {
  try {
    return sessionStorage.getItem(CALIBRATION_ASKED) === '1';
  } catch {
    return false;
  }
}
function markCalibrationAsked() {
  try {
    sessionStorage.setItem(CALIBRATION_ASKED, '1');
  } catch {
    // 저장소를 못 쓰면 다음에 다시 물어도 괜찮다
  }
}

type Dialog = { kind: 'calibrate'; resolve(go: boolean): void } | { kind: 'preferred' } | null;

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 10;

function SheetPreview({
  stamps,
  images,
  cal,
  deps,
}: {
  stamps: Stamp[];
  images: Map<string, Loaded>;
  cal: Calibration;
  deps: QueueDeps;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const entries = SLOTS.map((_, i) => {
    const s = stamps[i];
    const loaded = s && images.get(imageKey(s));
    return s && loaded && 'img' in loaded ? { image: loaded.img, crop: s.crop } : null;
  });
  useEffect(() => {
    if (ref.current) deps.drawPreview(ref.current, entries, cal);
  });
  return <canvas ref={ref} class="sheet-canvas" width={900} height={900} />;
}

export function QueueSheets({ deps = defaultDeps }: { deps?: QueueDeps }) {
  const { open, refresh, version, settings, reloadSettings } = useApp();
  const [queue, setQueue] = useState<Stamp[] | null>(null);
  const [images, setImages] = useState(new Map<string, Loaded>());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const drag = useRef<{ id: string; x: number; y: number; timer: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);

  const cal = settings?.calibration ?? DEFAULT_CALIBRATION;
  const shareOk = deps.canShareFiles();

  useEffect(() => {
    listQueue().then(setQueue);
  }, [version]);

  // 큐에 새로 들어온 우표의 출력용 이미지를 받는다
  useEffect(() => {
    if (!queue) return;
    let cancelled = false;
    for (const s of queue) {
      const key = imageKey(s);
      if (images.has(key)) continue;
      deps
        .loadStampImage(s)
        .then((img): Loaded => ({ img }))
        .catch((): Loaded => ({ error: true }))
        .then((loaded) => {
          if (!cancelled) setImages((m) => new Map(m).set(key, loaded));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [queue]);

  // 길게 눌러 끄는 동안에는 화면이 스크롤되지 않게 한다
  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (drag.current?.active) e.preventDefault();
    };
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => document.removeEventListener('touchmove', onTouchMove);
  }, []);

  if (!queue) return <section class="section" aria-label="출력 대기" />;

  const sheets = chunkIntoSheets(queue);

  const moveTo = async (id: string, targetIndex: number) => {
    const ids = queue.map((s) => s.id).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(targetIndex, ids.length)), 0, id);
    await reorderQueue(ids);
    refresh();
  };

  const remove = async (s: Stamp) => {
    setMenuFor(null);
    if (!window.confirm(`'${s.title}'을(를) 대기열에서 지울까요?`)) return;
    await deleteStamp(s.id);
    refresh();
  };

  const askCalibration = () => new Promise<boolean>((resolve) => setDialog({ kind: 'calibrate', resolve }));

  const output = async (sheetIndex: number, how: 'share' | 'save') => {
    if (busy) return;
    if (settings && !settings.calibrated && !calibrationAsked()) {
      markCalibrationAsked();
      const goCalibrate = await askCalibration();
      setDialog(null);
      if (goCalibrate) {
        open({ kind: 'settings' });
        return;
      }
    }
    const stamps = sheets[sheetIndex];
    const entries: SheetEntry[] = [];
    for (const s of stamps) {
      const loaded = images.get(imageKey(s));
      if (!loaded || !('img' in loaded)) {
        showToast('이미지를 불러올 수 없는 우표가 있어요');
        return;
      }
      entries.push({ image: loaded.img, crop: s.crop });
    }
    setBusy(true);
    try {
      const blob = await deps.renderSheet(entries, cal);
      const name = sheetFileName(new Date(), sheetIndex + 1);
      if (how === 'share') {
        if ((await deps.shareSheet(blob, name)) === 'cancelled') return;
      } else {
        deps.saveSheet(blob, name);
      }
      const prev = await markMade(
        stamps.map((s) => s.id),
        Date.now(),
      );
      refresh();
      showToast('만든 우표로 옮겼어요', {
        label: '되돌리기',
        run: async () => {
          for (const p of prev) await returnToQueue(p.id, p.queueOrder);
          refresh();
        },
      });
      if (!settings?.preferredOutput) setDialog({ kind: 'preferred' });
    } catch {
      showToast('시트를 만들지 못했어요');
    } finally {
      setBusy(false);
    }
  };

  const choosePreferred = async (preferred: 'share' | 'save' | null) => {
    setDialog(null);
    if (!preferred) return;
    await saveSettings({ preferredOutput: preferred });
    await reloadSettings();
  };

  const onSlotPointerDown = (e: PointerEvent, id: string) => {
    if (e.button !== 0) return;
    const timer = window.setTimeout(() => {
      if (!drag.current) return;
      drag.current.active = true;
      setDragId(id);
      setOverId(id);
      navigator.vibrate?.(15);
    }, LONG_PRESS_MS);
    drag.current = { id, x: e.clientX, y: e.clientY, timer, active: false };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > MOVE_CANCEL_PX) {
        clearTimeout(d.timer);
        drag.current = null;
      }
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-stamp-id]');
    setOverId(el?.dataset.stampId ?? null);
  };

  const onPointerUp = async () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    clearTimeout(d.timer);
    if (!d.active) return;
    suppressClick.current = true;
    const target = overId;
    setDragId(null);
    setOverId(null);
    if (target && target !== d.id) {
      await moveTo(
        d.id,
        queue.findIndex((s) => s.id === target),
      );
    }
  };

  const primary = settings?.preferredOutput ?? (shareOk ? 'share' : 'save');

  return (
    <section
      class="section"
      aria-label="출력 대기"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <h2>출력 대기</h2>
      {queue.length === 0 ? (
        <p class="muted">영화를 검색해서 우표를 담아 보세요</p>
      ) : (
        <p class="muted">
          출력 대기 {queue.length}장 → 시트 {sheets.length}장
        </p>
      )}

      <div class="sheets">
        {sheets.map((stamps, sheetIndex) => {
          // 시트의 이미지를 모두 받아(또는 실패해) 둔 뒤에만 출력할 수 있다
          const ready = stamps.every((s) => images.has(imageKey(s)));
          return (
          <article class="sheet-card" key={sheetIndex} aria-label={`시트 ${sheetIndex + 1}`}>
            <div class="sheet-paper">
              <SheetPreview stamps={stamps} images={images} cal={cal} deps={deps} />
              {stamps.map((s, i) => {
                const slot = SLOTS[i];
                const loaded = images.get(imageKey(s));
                const low = loaded && 'img' in loaded && isLowRes(loaded.img.width, loaded.img.height, s.crop);
                const style = {
                  left: `${(slot.xMm / PAPER_MM) * 100}%`,
                  top: `${(slot.yMm / PAPER_MM) * 100}%`,
                  width: `${(slot.wMm / PAPER_MM) * 100}%`,
                  height: `${(slot.hMm / PAPER_MM) * 100}%`,
                };
                const cls = ['slot', dragId === s.id && 'dragging', dragId && overId === s.id && dragId !== s.id && 'drop-target']
                  .filter(Boolean)
                  .join(' ');
                return (
                  <div class={cls} style={style} key={s.id} data-stamp-id={s.id}>
                    <button
                      class="slot-hit"
                      aria-label={`${s.title} 조정`}
                      onPointerDown={(e) => onSlotPointerDown(e, s.id)}
                      onContextMenu={(e) => e.preventDefault()}
                      onClick={() => {
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        open({ kind: 'crop', stampId: s.id });
                      }}
                    />
                    {low && (
                      <span class="slot-warn" aria-label="해상도 낮음" title="해상도 낮음">
                        ⚠
                      </span>
                    )}
                    {loaded && 'error' in loaded && <span class="slot-error">이미지 오류</span>}
                    <button
                      class="slot-menu-btn"
                      aria-label={`${s.title} 메뉴`}
                      onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}
                    >
                      ⋯
                    </button>
                    {menuFor === s.id && (
                      <div class="slot-menu" role="menu">
                        <button
                          role="menuitem"
                          disabled={queue[0].id === s.id}
                          onClick={() => {
                            setMenuFor(null);
                            moveTo(s.id, queue.indexOf(s) - 1);
                          }}
                        >
                          앞으로 이동
                        </button>
                        <button
                          role="menuitem"
                          disabled={queue[queue.length - 1].id === s.id}
                          onClick={() => {
                            setMenuFor(null);
                            moveTo(s.id, queue.indexOf(s) + 1);
                          }}
                        >
                          뒤로 이동
                        </button>
                        <button role="menuitem" class="danger" onClick={() => remove(s)}>
                          삭제
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div class="row sheet-actions">
              {shareOk && (
                <button
                  class={`btn ${primary === 'share' ? 'primary' : ''}`}
                  aria-label={`시트 ${sheetIndex + 1} 공유`}
                  disabled={busy || !ready}
                  onClick={() => output(sheetIndex, 'share')}
                >
                  공유
                </button>
              )}
              <button
                class={`btn ${primary === 'save' ? 'primary' : ''}`}
                aria-label={`시트 ${sheetIndex + 1} 저장`}
                disabled={busy || !ready}
                onClick={() => output(sheetIndex, 'save')}
              >
                저장
              </button>
            </div>
          </article>
          );
        })}
      </div>

      {dialog?.kind === 'calibrate' && (
        <div class="modal-backdrop">
          <div class="modal" role="alertdialog" aria-label="출력 보정 안내">
            <p>테스트 시트를 먼저 출력해 보세요</p>
            <p class="muted">인화지와 펀칭 위치가 맞는지 확인한 뒤 출력하면 카트리지를 아낄 수 있어요.</p>
            <div class="row">
              <button class="btn primary" onClick={() => dialog.resolve(true)}>
                보정하러 가기
              </button>
              <button class="btn" onClick={() => dialog.resolve(false)}>
                그냥 진행
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog?.kind === 'preferred' && (
        <div class="modal-backdrop">
          <div class="modal" role="alertdialog" aria-label="출력 방법">
            <p>어느 방법으로 출력하셨나요?</p>
            <div class="row">
              {shareOk && (
                <button class="btn" onClick={() => choosePreferred('share')}>
                  공유로 출력
                </button>
              )}
              <button class="btn" onClick={() => choosePreferred('save')}>
                저장해서 출력
              </button>
              <button class="btn" onClick={() => choosePreferred(null)}>
                아직 모르겠어요
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
