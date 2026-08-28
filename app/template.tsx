// DEPLOY TO: app/template.tsx
"use client";

// Next.js remounts template.tsx on every navigation (unlike layout.tsx),
// which is what makes a per-route entrance animation possible here. This
// gives every page in the app a consistent, subtle arrival — no page
// needs its own transition code.
//
// Note: App Router doesn't support exit animations without holding the
// previous route in memory (a much bigger architectural change, not
// worth the complexity for this pass) — so this is entrance-only. An
// honest fade+slide-in reads as intentional; it doesn't need a fake exit
// to feel complete.

import { motion, useReducedMotion } from "framer-motion";
import { springs } from "@/lib/motion/tokens";

export default function Template({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.page}
    >
      {children}
    </motion.div>
  );
}
