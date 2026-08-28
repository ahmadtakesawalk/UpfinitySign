// DEPLOY TO: components/marketing/SignatureMark.tsx
"use client";

// The hero's signature element (literally): an SVG path drawn on load via
// strokeDasharray/strokeDashoffset animation, echoing the exact motion of
// signing something. This is the one deliberate "boldness" spend for the
// landing page — everything else around it stays quiet.

import { motion, useReducedMotion } from "framer-motion";

export function SignatureMark({ width = 320, height = 100 }: { width?: number; height?: number }) {
  const reduceMotion = useReducedMotion();

  return (
    <svg width={width} height={height} viewBox="0 0 320 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <motion.path
        d="M12 70 C 40 20, 60 20, 78 55 C 92 82, 108 82, 118 50 C 126 24, 140 24, 150 60 C 158 86, 172 86, 182 48 C 192 14, 212 14, 222 52 C 230 80, 248 80, 262 40"
        stroke="var(--accent)"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduceMotion ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0.4 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
      />
      <motion.circle
        cx={280}
        cy={30}
        r={4}
        fill="var(--accent)"
        initial={reduceMotion ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduceMotion ? { duration: 0 } : { ...{ type: "spring", stiffness: 400, damping: 20 }, delay: 1.15 }}
      />
    </svg>
  );
}
