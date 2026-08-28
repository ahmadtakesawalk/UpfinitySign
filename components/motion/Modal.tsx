// DEPLOY TO: components/motion/Modal.tsx
"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { springs } from "@/lib/motion/tokens";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number | string;
  // Near-fullscreen, DocuSign-style ("Set Up Envelope") flow — vs. a
  // smaller centered card for confirmations/simple forms.
  fullBleed?: boolean;
}

export function Modal({ open, onClose, children, width = 640, fullBleed = false }: ModalProps) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduceMotion ? { duration: 0.01 } : springs.standard}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(20, 21, 26, 0.45)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: fullBleed ? "stretch" : "center",
            justifyContent: "center",
            padding: fullBleed ? 0 : 24,
          }}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={reduceMotion ? { opacity: 0 } : fullBleed ? { opacity: 0, scale: 0.99 } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : fullBleed ? { opacity: 0, scale: 0.99 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={reduceMotion ? { duration: 0.01 } : springs.standard}
            style={{
              background: "var(--bg-page)",
              width: fullBleed ? "100%" : width,
              height: fullBleed ? "100%" : "auto",
              maxHeight: fullBleed ? "100%" : "88vh",
              borderRadius: fullBleed ? 0 : "var(--radius-lg)",
              boxShadow: "var(--shadow-lg)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
