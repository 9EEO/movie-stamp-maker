import { useEffect, useState } from 'preact/hooks';
import { listMade } from '../data/db';
import { useApp } from './context';
import { QueueSheets } from './QueueSheets';
import { Search } from './Search';

export function Home() {
  const { open, refresh, tmdb, version } = useApp();
  const [madeCount, setMadeCount] = useState<number | null>(null);

  useEffect(() => {
    listMade().then((m) => setMadeCount(m.length));
  }, [version]);

  return (
    <div class="home">
      <header class="topbar">
        <h1>내 우표 컬렉션</h1>
        <div class="topbar-actions">
          <button class="icon-btn" aria-label="설정" onClick={() => open({ kind: 'settings' })}>
            ⚙
          </button>
        </div>
      </header>

      <Search
        tmdb={tmdb}
        onOpenSettings={() => open({ kind: 'settings' })}
        onAdded={(stampId) => {
          refresh();
          open({ kind: 'crop', stampId });
        }}
      />

      <QueueSheets />

      <section class="section" aria-label="만든 우표">
        <h2>만든 우표</h2>
        <p class="muted">{madeCount === null ? '' : `${madeCount}개`}</p>
      </section>
    </div>
  );
}
