// DEPLOY TO: components/motion/Button.tsx
"use client";

// Drop-in replacement for a plain <button className="primary|secondary|danger">.
// Same classes, same visual system from globals.css — this only adds the
// spring-based press/hover feedback on top. Existing forms using raw
// <button> elements keep working unchanged; adopt this incrementally.
//
// Defaults to type="button", not the native HTML default of "submit" — an
// unspecified <button> nested inside a <form> (the Google/Microsoft
// sign-in buttons sitting inside the email/password form, for example)
// would otherwise submit that form instead of doing its own onClick/href
// action. Any caller that actually wants a submit button still gets one by
// passing type="submit" explicitly, same as every submit button in this
// codebase already does.

import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { springs, pressScale, hoverLift } from "@/lib/motion/tokens";

type Variant = "primary" | "secondary" | "danger";

// Based on motion's own prop type (not React's ButtonHTMLAttributes) —
// avoids the onDrag/onAnimationStart signature clashes that happen when
// intersecting plain HTML button props with motion.button.
interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: Variant;
}

export function Button({ variant = "primary", type = "button", className = "", children, disabled, ...props }: ButtonProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.button
      type={type}
      className={`${variant} ${className}`.trim()}
      disabled={disabled}
      whileTap={disabled || reduceMotion ? undefined : { scale: pressScale }}
      whileHover={disabled || reduceMotion ? undefined : { y: hoverLift }}
      transition={springs.micro}
      {...props}
    >
      {children}
    </motion.button>
  );
}
