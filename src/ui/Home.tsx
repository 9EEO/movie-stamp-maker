import { useApp } from './context';
import { MadeGallery } from './MadeGallery';
import { QueueSheets } from './QueueSheets';
import { Search } from './Search';

export function Home() {
  const { open, refresh, tmdb } = useApp();

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

      <MadeGallery />
    </div>
  );
}
