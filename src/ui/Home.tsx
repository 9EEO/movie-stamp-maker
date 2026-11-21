import { useApp } from './context';
import { MadeGallery } from './MadeGallery';
import { QueueSheets } from './QueueSheets';
import { Search } from './Search';
import { showToast } from './Toast';

function addedManyMessage(added: number, skipped: number, storageFailed: boolean): string {
  if (storageFailed) return `${added}장을 담았고, 나머지는 저장하지 못했어요. 저장 공간을 확인해 주세요`;
  if (added === 0) return '사진을 열 수 없어 담지 못했어요';
  if (skipped > 0) return `${added}장을 담았어요. ${skipped}장은 열 수 없어 건너뛰었어요`;
  return `${added}장을 대기열에 담았어요`;
}

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
        onAddedMany={(added, skipped, storageFailed) => {
          refresh();
          showToast(addedManyMessage(added, skipped, storageFailed));
        }}
      />

      <QueueSheets />

      <MadeGallery />
    </div>
  );
}
