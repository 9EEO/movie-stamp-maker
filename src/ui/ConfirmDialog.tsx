import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { useApp } from './context';

interface Ask {
  message: string;
  okLabel: string;
  answer(ok: boolean): void;
}

/**
 * 브라우저 기본 confirm 대신 쓰는 확인 대화상자.
 * Chrome은 기본 confirm을 띄우지 않고 바로 취소로 돌려줄 때가 있어, 앱이 직접 그린다.
 * history에 한 칸을 쌓으므로 뒤로가기를 누르면 대화상자만 닫힌다(= 취소).
 */
export function useConfirm(): [(message: string, okLabel: string) => Promise<boolean>, VNode | null] {
  const { pushModal } = useApp();
  const [ask, setAsk] = useState<Ask | null>(null);

  const confirm = (message: string, okLabel: string) =>
    new Promise<boolean>((resolve) => {
      let ok = false;
      const modal = pushModal(() => {
        setAsk(null);
        resolve(ok);
      });
      setAsk({
        message,
        okLabel,
        answer(choice) {
          ok = choice;
          modal.dismiss();
        },
      });
    });

  const dialog = ask && (
    <div class="modal-backdrop">
      <div class="modal" role="alertdialog" aria-label="삭제 확인">
        <p>{ask.message}</p>
        <div class="row">
          <button class="btn danger" onClick={() => ask.answer(true)}>
            {ask.okLabel}
          </button>
          <button class="btn" onClick={() => ask.answer(false)}>
            취소
          </button>
        </div>
      </div>
    </div>
  );

  return [confirm, dialog];
}
