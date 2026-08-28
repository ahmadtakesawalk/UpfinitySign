// DEPLOY TO: components/motion/Spinner.tsx
"use client";

// For inline/button loading states only (a Save button mid-request, a
// small inline wait). For content-shaped loading — lists, tables,
// dashboard cards — use Skeleton/SkeletonRows instead; a generic spinner
// over list-shaped content is the wrong pattern in this system.

import { motion, useReducedMotion } from "framer-motion";

export function Spinner({ size = 20, color = "var(--accent)" }: { size?: number; color?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ flexShrink: 0 }}
      animate={reduceMotion ? undefined : { rotate: 360 }}
      transition={reduceMotion ? undefined : { duration: 0.7, repeat: Infinity, ease: "linear" }}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--border)" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </motion.svg>
  );
}
