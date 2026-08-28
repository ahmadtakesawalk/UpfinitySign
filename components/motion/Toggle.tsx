// DEPLOY TO: components/motion/Toggle.tsx
"use client";

import { motion, useReducedMotion } from "framer-motion";
import { springs } from "@/lib/motion/tokens";

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  label?: string;
  size?: "sm" | "md";
}

export function Toggle({ checked, onChange, label, size = "sm" }: ToggleProps) {
  const reduceMotion = useReducedMotion();
  const width = size === "sm" ? 30 : 36;
  const height = size === "sm" ? 16 : 20;
  const knob = size === "sm" ? 12 : 16;
  const pad = (height - knob) / 2;

  return (
    <button
      type="button"
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", cursor: "pointer", padding: 2 }}
    >
      <motion.span
        animate={{ backgroundColor: checked ? "var(--accent)" : "var(--border-strong)" }}
        transition={reduceMotion ? { duration: 0.01 } : springs.micro}
        style={{ width, height, borderRadius: 999, position: "relative", flexShrink: 0, display: "block" }}
      >
        <motion.span
          initial={false}
          animate={{ x: checked ? width - knob - pad * 2 : 0 }}
          transition={reduceMotion ? { duration: 0.01 } : springs.micro}
          style={{
            position: "absolute",
            top: pad,
            left: pad,
            width: knob,
            height: knob,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
          }}
        />
      </motion.span>
      {label && <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{label}</span>}
    </button>
  );
}
