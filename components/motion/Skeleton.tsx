// DEPLOY TO: components/motion/Skeleton.tsx
"use client";

// Shimmer placeholder for async content (dashboard tables, envelope
// lists) — pass width/height/radius to match the shape of what's loading.
// Falls back to a static block (no shimmer) under prefers-reduced-motion,
// handled purely in CSS via .skeleton's own media query — see globals.css.

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string;
  className?: string;
}

export function Skeleton({ width = "100%", height = 16, radius = "var(--radius-sm)", className = "" }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`.trim()}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={44} />
      ))}
    </div>
  );
}
