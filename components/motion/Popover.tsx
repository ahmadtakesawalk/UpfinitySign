// DEPLOY TO: components/motion/Popover.tsx
"use client";

import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { springs } from "@/lib/motion/tokens";

interface PopoverProps {
  open: boolean;
  children: ReactNode;
  style?: CSSProperties;
  // Where this popover scales in from — should match which corner sits
  // nearest its trigger. Defaults to "top left" (the common case: a
  // dropdown opening below-and-right of its trigger). Popovers should
  // scale from their trigger, never from center — that's a modal-only
  // exception.
  origin?: "top left" | "top right" | "bottom left" | "bottom right";
}

// Floating panel chrome for small in-context menus (role pickers, quick
// option lists). Not a positioning engine — the caller supplies
// top/left/etc via `style`; this standardizes the card look + entrance.
export function Popover({ open, children, style, origin = "top left" }: PopoverProps) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.97 }}
          transition={reduceMotion ? { duration: 0.01 } : springs.micro}
          style={{
            position: "absolute",
            transformOrigin: origin,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "var(--shadow-lg)",
            padding: 4,
            zIndex: 30,
            ...style,
          }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
