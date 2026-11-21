import { useEffect, useState } from 'preact/hooks';

interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastData {
  id: number;
  msg: string;
  action?: ToastAction;
}

let seq = 0;
let push: ((t: ToastData) => void) | null = null;

export function showToast(msg: string, action?: ToastAction): void {
  push?.({ id: ++seq, msg, action });
}

export function ToastHost() {
  const [toast, setToast] = useState<ToastData | null>(null);

  useEffect(() => {
    push = setToast;
    return () => {
      push = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), toast.action ? 6000 : 3000);
    return () => clearTimeout(h);
  }, [toast]);

  if (!toast) return null;
  return (
    <div class="toast" role="status">
      <span>{toast.msg}</span>
      {toast.action && (
        <button
          class="toast-action"
          onClick={() => {
            toast.action!.run();
            setToast(null);
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
