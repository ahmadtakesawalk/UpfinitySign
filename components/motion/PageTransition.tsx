// DEPLOY TO: components/motion/PageTransition.tsx
"use client";

// Wraps every route in the app so navigating between pages animates
// instead of hard-cutting — springs.page has existed in lib/motion/tokens
// since early this session specifically for this purpose, but nothing
// ever actually keyed a transition off route changes until now.
// mode="wait" (not a crossfade) deliberately, since two full dashboard
// pages overlapping mid-transition would double up scrollbars/layout —
// the brief gap stays short because springs.page itself is tuned snappy
// (stiffness 220), not because this skips animation.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { springs } from "@/lib/motion/tokens";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return <>{children}</>;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={springs.page}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
