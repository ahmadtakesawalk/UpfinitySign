// DEPLOY TO: components/motion/Reveal.tsx
"use client";

// Same play-once-when-scrolled-into-view behavior as Card's revealOnScroll,
// for content that isn't a card (step rows, FAQ items, section intros).
// Marketing/landing use only — dashboard content stays as-is.

import type { ReactNode, CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { springs, staggerStep } from "@/lib/motion/tokens";

export function Reveal({ children, index = 0, className, style }: { children: ReactNode; index?: number; className?: string; style?: CSSProperties }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      style={style}
      initial={reduceMotion ? undefined : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ ...springs.standard, delay: reduceMotion ? 0 : index * staggerStep }}
    >
      {children}
    </motion.div>
  );
}
