// DEPLOY TO: lib/motion/tokens.ts
//
// Single source of truth for every animation value in the product.
// Everything is spring-based, not duration/easing-based — springs respond
// to interruption physically (e.g. clicking a button mid-hover doesn't
// snap or restart, it re-targets from wherever it currently is). This is
// the core mechanical difference between "animated" and "feels native."
//
// Three tiers, by what's moving:
//  - micro:    small interactive elements (buttons, checkboxes, badges)
//  - standard: cards, panels, list items, toasts
//  - page:     full page/route-level transitions
//
// Import a token, never hand-roll a transition inline — that's how motion
// drifts inconsistent across the app.

import type { Transition } from "framer-motion";

export const springs: Record<"micro" | "standard" | "page", Transition> = {
  micro: { type: "spring", stiffness: 500, damping: 32, mass: 0.7 },
  standard: { type: "spring", stiffness: 320, damping: 30, mass: 0.9 },
  page: { type: "spring", stiffness: 220, damping: 28, mass: 1 },
};

// For opacity-only fades where a spring would be overkill (e.g. skeleton
// shimmer, backdrop dim).
export const durations = {
  fast: 0.12,
  base: 0.2,
  slow: 0.32,
};

// Stagger delay between successive list/grid items on entrance.
export const staggerStep = 0.045;

// Shared tap/hover deltas for interactive elements — kept here so every
// button/card lifts and presses by the exact same amount.
export const pressScale = 0.97;
export const hoverLift = -1; // px
