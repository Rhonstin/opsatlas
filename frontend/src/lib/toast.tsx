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
          position: 'fixed', bottom: 24, right: 24,
          display: 'flex', flexDirection: 'column', gap: 8,
          zIndex: 9999,
        }}>
          {list.map((t) => (
            <div
              key={t.id}
              onClick={() => dismiss(t.id)}
              style={{
                padding: '10px 16px',
                borderRadius: 8,
                background: BG[t.type],
                color: '#fff',
                fontSize: 13,
                fontWeight: 500,
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                cursor: 'pointer',
                maxWidth: 320,
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
