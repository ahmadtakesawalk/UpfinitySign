// DEPLOY TO: components/motion/Card.tsx
"use client";

// Drop-in replacement for a plain <div className="card">. Fades/lifts in
// on mount; pass `index` when rendering a list so items stagger in one
// after another instead of popping in simultaneously.

import { motion, useReducedMotion } from "framer-motion";
import type { HTMLMotionProps } from "framer-motion";
import { springs, staggerStep } from "@/lib/motion/tokens";

interface CardProps extends HTMLMotionProps<"div"> {
  index?: number;
  hoverable?: boolean;
  // Mount-based fade/lift (the default) is invisible for anything below the
  // fold — it's already finished animating by the time it scrolls into
  // view. Landing-page sections want the opposite: play once, the moment
  // the card actually enters the viewport. Additive/opt-in so every
  // existing usage (dashboard, editors) keeps its current mount behavior.
  revealOnScroll?: boolean;
}

export function Card({ index = 0, hoverable = false, revealOnScroll = false, className = "", children, ...props }: CardProps) {
  const reduceMotion = useReducedMotion();
  const motionProps = revealOnScroll
    ? { initial: reduceMotion ? undefined : { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" } }
    : { initial: reduceMotion ? undefined : { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <motion.div
      className={`card ${className}`.trim()}
      {...motionProps}
      transition={{ ...springs.standard, delay: reduceMotion ? 0 : index * staggerStep }}
      whileHover={hoverable && !reduceMotion ? { y: -2, boxShadow: "var(--shadow-lg)" } : undefined}
      {...props}
    >
      {children}
    </motion.div>
  );
}
