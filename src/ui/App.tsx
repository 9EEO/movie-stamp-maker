import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type Settings as SettingsData, getSettings, saveSettings } from '../data/db';
import { type Tmdb, createTmdb } from '../tmdb/client';
import { AppContext, type AppContextValue, type Overlay } from './context';
import { CropEditor } from './CropEditor';
import { Home } from './Home';
import { StampDetail } from './MadeGallery';
import { type SettingsDeps, Settings, defaultSettingsDeps } from './Settings';
import { ToastHost } from './Toast';

export type { Overlay } from './context';

type Entry = { kind: 'overlay'; overlay: Overlay } | { kind: 'modal'; onBack: () => void };

/**
 * 오버레이·대화상자 스택. 열 때 history에 한 칸을 쌓고, popstate(안드로이드 뒤로가기)가 오면 맨 위만 닫는다.
 * 닫기 버튼도 history.back()으로 닫아 history와 스택이 어긋나지 않게 한다.
 */
export function useOverlays() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const ref = useRef<Entry[]>([]);
  const update = (next: Entry[]) => {
    ref.current = next;
    setEntries(next);
  };

  useEffect(() => {
    const onPop = () => {
      const current = ref.current;
      if (current.length === 0) return;
      const top = current[current.length - 1];
      update(current.slice(0, -1));
      if (top.kind === 'modal') top.onBack();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback((o: Overlay) => {
    history.pushState({ overlay: o.kind }, '');
    update([...ref.current, { kind: 'overlay', overlay: o }]);
  }, []);

  const close = useCallback(() => {
    if (ref.current.length > 0) history.back();
  }, []);

  const pushModal = useCallback((onBack: () => void) => {
    const entry: Entry = { kind: 'modal', onBack };
    history.pushState({ overlay: 'modal' }, '');
    update([...ref.current, entry]);
    return {
      dismiss() {
        if (ref.current[ref.current.length - 1] === entry) history.back();
      },
    };
  }, []);

  const stack = entries.flatMap((e) => (e.kind === 'overlay' ? [e.overlay] : []));
  return { stack, open, close, pushModal };
}

function OverlayView({ overlay, close, settingsDeps }: { overlay: Overlay; close(): void; settingsDeps: SettingsDeps }) {
  switch (overlay.kind) {
    case 'crop':
      return <CropEditor key={overlay.stampId} stampId={overlay.stampId} onDone={close} />;
    case 'detail':
      return <StampDetail key={overlay.stampId} stampId={overlay.stampId} />;
    case 'settings':
      return <Settings deps={settingsDeps} />;
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

/** 홈 화면 추가 안내는 한 번만: 띄우는 순간 installPrompted를 저장한다. */
function useInstallPrompt(settings: SettingsData | null) {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const [promptedAtStart, setPromptedAtStart] = useState<boolean | null>(null);
  useEffect(() => {
    if (settings && promptedAtStart === null) setPromptedAtStart(settings.installPrompted);
  }, [settings, promptedAtStart]);

  const show = !!event && promptedAtStart === false && !dismissed;
  useEffect(() => {
    if (show) saveSettings({ installPrompted: true });
  }, [show]);

  return { event: show ? event : null, dismiss: () => setDismissed(true) };
}

function InstallBanner({ onInstall, onLater }: { onInstall(): void; onLater(): void }) {
  return (
    <div class="install-banner" role="region" aria-label="홈 화면에 추가">
      <p>홈 화면에 추가하면 앱처럼 쓸 수 있고 데이터도 안전해요</p>
      <div class="row">
        <button class="btn primary" onClick={onInstall}>
          홈 화면에 추가
        </button>
        <button class="btn" onClick={onLater}>
          나중에
        </button>
      </div>
    </div>
  );
}

interface Props {
  makeTmdb?: (key: string) => Tmdb;
}

// 렌더링마다 새 함수가 되면 TMDB 클라이언트가 매번 바뀌어 검색이 다시 돈다
const defaultMakeTmdb = (key: string) => createTmdb(key);

export function App({ makeTmdb = defaultMakeTmdb }: Props) {
  const { stack, open, close, pushModal } = useOverlays();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [version, setVersion] = useState(0);

  const reloadSettings = useCallback(async () => setSettings(await getSettings()), []);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    reloadSettings();
    // 브라우저가 저장소를 임의로 비우지 않게 요청한다
    navigator.storage?.persist?.().catch(() => {});
  }, [reloadSettings]);

  // 오버레이가 닫히면 그 안에서 바뀐 데이터를 다시 읽는다
  useEffect(() => {
    refresh();
  }, [stack.length, refresh]);

  const tmdbKey = settings?.tmdbKey;
  const tmdb = useMemo(() => (tmdbKey ? makeTmdb(tmdbKey) : null), [tmdbKey, makeTmdb]);

  const settingsDeps = useMemo(() => ({ ...defaultSettingsDeps, makeTmdb }), [makeTmdb]);
  const installEvent = useInstallPrompt(settings);

  const value: AppContextValue = { open, close, pushModal, refresh, version, settings, reloadSettings, tmdb };
  const top = stack[stack.length - 1];

  return (
    <AppContext.Provider value={value}>
      <div class="app" aria-hidden={top ? 'true' : undefined}>
        {installEvent.event && (
          <InstallBanner
            onInstall={() => {
              installEvent.event?.prompt();
              installEvent.dismiss();
            }}
            onLater={installEvent.dismiss}
          />
        )}
        <Home />
      </div>
      {top && <OverlayView overlay={top} close={close} settingsDeps={settingsDeps} />}
      <ToastHost />
    </AppContext.Provider>
  );
}
