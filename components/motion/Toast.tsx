// DEPLOY TO: components/motion/Toast.tsx
"use client";

// Every form in the product currently POSTs silently with no success/error
// feedback. This fills that gap. Wrap the root layout's children in
// <ToastProvider>, then call useToast().show(...) from any client
// component after a fetch resolves.
//
// Usage:
//   const { show } = useToast();
//   show({ message: "Webhook saved", type: "success" });

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { springs } from "@/lib/motion/tokens";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastInput {
  message: string;
  type?: ToastType;
  durationMs?: number;
}

interface ToastContextValue {
  show: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const TYPE_STYLE: Record<ToastType, { bg: string; fg: string }> = {
  success: { bg: "var(--success-bg)", fg: "var(--success)" },
  error: { bg: "var(--danger-bg)", fg: "var(--danger)" },
  info: { bg: "var(--pending-bg)", fg: "var(--text-primary)" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const reduceMotion = useReducedMotion();

  const show = useCallback(({ message, type = "info", durationMs = 4000 }: ToastInput) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, durationMs);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 1000,
          pointerEvents: "none",
        }}
      >
        <AnimatePresence>
          {toasts.map((t) => {
            const style = TYPE_STYLE[t.type];
            return (
              <motion.div
                key={t.id}
                layout
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 40, transition: { duration: 0.15 } }}
                transition={reduceMotion ? { duration: 0.01 } : springs.standard}
                style={{
                  background: style.bg,
                  color: style.fg,
                  padding: "12px 16px",
                  borderRadius: "var(--radius-sm)",
                  boxShadow: "var(--shadow-lg)",
                  fontSize: 14,
                  fontWeight: 500,
                  maxWidth: 320,
                  pointerEvents: "auto",
                }}
              >
                {t.message}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
