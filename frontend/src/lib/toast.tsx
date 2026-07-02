'use client';
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem { id: number; type: ToastType; message: string; }
interface ToastCtx { toast: (type: ToastType, message: string) => void; }

const Ctx = createContext<ToastCtx>({ toast: () => {} });

let seq = 0;

const BG: Record<ToastType, string> = {
  success: 'var(--success)',
  error: 'var(--danger)',
  info: 'var(--accent)',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastItem[]>([]);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = ++seq;
    setList((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setList((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setList((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      {list.length > 0 && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem',
          display: 'flex', flexDirection: 'column', gap: '0.5rem',
          zIndex: 9999,
        }}>
          {list.map((t) => (
            <div
              key={t.id}
              onClick={() => dismiss(t.id)}
              style={{
                padding: '0.625rem 1rem',
                borderRadius: '0.5rem',
                background: BG[t.type],
                color: 'var(--color-accent-text)',
                fontSize: '0.8125rem',
                fontWeight: 500,
                boxShadow: '0 0.25rem 1.25rem rgba(0,0,0,0.4)',
                cursor: 'pointer',
                maxWidth: '20rem',
                lineHeight: 1.5,
                animation: 'toastIn 0.15s ease',
              }}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  return useContext(Ctx);
}
