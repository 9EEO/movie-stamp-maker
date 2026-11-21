import { useEffect, useState } from 'preact/hooks';
import { listMade, listQueue } from '../data/db';
import { useApp } from './context';
import { Search } from './Search';

export function Home() {
  const { open, refresh, tmdb, version } = useApp();
  const [counts, setCounts] = useState<{ queue: number; made: number } | null>(null);

  useEffect(() => {
    Promise.all([listQueue(), listMade()]).then(([q, m]) => setCounts({ queue: q.length, made: m.length }));
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

      <section class="section" aria-label="출력 대기">
        <h2>출력 대기</h2>
        <p class="muted">{counts ? `${counts.queue}개` : ''}</p>
      </section>

      <section class="section" aria-label="만든 우표">
        <h2>만든 우표</h2>
        <p class="muted">{counts ? `${counts.made}개` : ''}</p>
      </section>
    </div>
  );
}
