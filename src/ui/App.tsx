import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type Settings, getSettings } from '../data/db';
import { type Tmdb, createTmdb } from '../tmdb/client';
import { AppContext, type AppContextValue, type Overlay } from './context';
import { CropEditor } from './CropEditor';
import { Home } from './Home';
import { StampDetail } from './MadeGallery';
import { OverlayFrame } from './OverlayFrame';
import { ToastHost } from './Toast';

export type { Overlay } from './context';

/**
 * 오버레이 스택. 열 때 history에 한 칸을 쌓고, popstate(안드로이드 뒤로가기)가 오면 맨 위만 닫는다.
 * 닫기 버튼도 history.back()으로 닫아 history와 스택이 어긋나지 않게 한다.
 */
export function useOverlays() {
  const [stack, setStack] = useState<Overlay[]>([]);
  const depth = useRef(0);

  useEffect(() => {
    const onPop = () => {
      if (depth.current === 0) return;
      depth.current--;
      setStack((s) => s.slice(0, -1));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback((o: Overlay) => {
    history.pushState({ overlay: o.kind }, '');
    depth.current++;
    setStack((s) => [...s, o]);
  }, []);

  const close = useCallback(() => {
    if (depth.current > 0) history.back();
  }, []);

  return { stack, open, close };
}

function OverlayView({ overlay, close }: { overlay: Overlay; close(): void }) {
  switch (overlay.kind) {
    case 'crop':
      return <CropEditor key={overlay.stampId} stampId={overlay.stampId} onDone={close} />;
    case 'detail':
      return <StampDetail key={overlay.stampId} stampId={overlay.stampId} />;
    case 'settings':
      return <OverlayFrame title="설정">준비 중</OverlayFrame>;
  }
}

interface Props {
  makeTmdb?: (key: string) => Tmdb;
}

export function App({ makeTmdb = (key) => createTmdb(key) }: Props) {
  const { stack, open, close } = useOverlays();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [version, setVersion] = useState(0);

  const reloadSettings = useCallback(async () => setSettings(await getSettings()), []);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    reloadSettings();
  }, [reloadSettings]);

  // 오버레이가 닫히면 그 안에서 바뀐 데이터를 다시 읽는다
  useEffect(() => {
    refresh();
  }, [stack.length, refresh]);

  const tmdbKey = settings?.tmdbKey;
  const tmdb = useMemo(() => (tmdbKey ? makeTmdb(tmdbKey) : null), [tmdbKey, makeTmdb]);

  const value: AppContextValue = { open, close, refresh, version, settings, reloadSettings, tmdb };
  const top = stack[stack.length - 1];

  return (
    <AppContext.Provider value={value}>
      <div class="app" aria-hidden={top ? 'true' : undefined}>
        <Home />
      </div>
      {top && <OverlayView overlay={top} close={close} />}
      <ToastHost />
    </AppContext.Provider>
  );
}
