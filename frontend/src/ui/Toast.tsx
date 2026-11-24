import { useCallback, useRef, useState, type ReactNode } from "react";

import { ToastContext, type ShowToast, type ToastAction, type ToastTone } from "./toastContext";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

const DURATION = { plain: 3500, action: 8000, error: 6000 }; // time enough to reach an Undo button

/** Short confirmations, errors, and actions like Undo; announced through a live region. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((item) => item.id !== id)), []);

  const show = useCallback<ShowToast>(
    (message, options) => {
      const { tone = "success", action } = typeof options === "string" ? { tone: options } : (options ?? {});
      const id = nextId.current++;
      setItems((list) => [...list.slice(-2), { id, message, tone, action }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? DURATION.error : action ? DURATION.action : DURATION.plain);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast--${item.tone}`}>
            <span>{item.message}</span>
            {item.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  dismiss(item.id);
                  item.action!.onClick();
                }}
              >
                {item.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
