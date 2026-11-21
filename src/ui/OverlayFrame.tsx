import type { ComponentChildren } from 'preact';
import { useApp } from './context';

interface Props {
  title: string;
  children: ComponentChildren;
  /** 위쪽 바 오른쪽에 둘 버튼 등 */
  actions?: ComponentChildren;
  class?: string;
}

/** 전체 화면 오버레이. 닫기(←)는 브라우저 뒤로가기와 같은 경로로 닫는다. */
export function OverlayFrame({ title, children, actions, class: cls }: Props) {
  const { close } = useApp();
  return (
    <div class={`overlay ${cls ?? ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header class="topbar">
        <button class="icon-btn" aria-label="닫기" onClick={close}>
          ←
        </button>
        <h2>{title}</h2>
        <div class="topbar-actions">{actions}</div>
      </header>
      <div class="overlay-body">{children}</div>
    </div>
  );
}
