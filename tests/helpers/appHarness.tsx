import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { type Settings, getSettings } from '../../src/data/db';
import type { Tmdb } from '../../src/tmdb/client';
import { AppContext, type AppContextValue } from '../../src/ui/context';
import { ToastHost } from '../../src/ui/Toast';

/** App 없이 화면 하나를 그릴 때 쓰는 AppContext. open/close는 기록만 한다. */
export function AppHarness({
  children,
  open = vi.fn(),
  tmdb = null,
}: {
  children: ComponentChildren;
  open?: AppContextValue['open'];
  tmdb?: Tmdb | null;
}) {
  const [version, setVersion] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const reloadSettings = async () => setSettings(await getSettings());
  useEffect(() => {
    reloadSettings();
  }, []);
  const value: AppContextValue = {
    open,
    close: vi.fn(),
    refresh: () => setVersion((v) => v + 1),
    version,
    settings,
    reloadSettings,
    tmdb,
  };
  return (
    <AppContext.Provider value={value}>
      {settings && children}
      <ToastHost />
    </AppContext.Provider>
  );
}
