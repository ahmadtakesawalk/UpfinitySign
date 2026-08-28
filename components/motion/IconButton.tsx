// DEPLOY TO: components/motion/IconButton.tsx
"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { springs, pressScale } from "@/lib/motion/tokens";

interface IconButtonProps {
  onClick: () => void;
  title: string;
  children: ReactNode;
  variant?: "default" | "danger";
  disabled?: boolean;
}

export function IconButton({ onClick, title, children, variant = "default", disabled = false }: IconButtonProps) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      whileTap={disabled || reduceMotion ? undefined : { scale: pressScale }}
      whileHover={disabled ? undefined : { backgroundColor: "var(--bg-subtle)", color: variant === "danger" ? "var(--danger)" : "var(--text-secondary)" }}
      transition={springs.micro}
      style={{
        width: 26,
        height: 26,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        background: "transparent",
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        color: "var(--text-secondary)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </motion.button>
  );
}
