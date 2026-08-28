// DEPLOY TO: app/icon.tsx
// Next.js App Router convention — this file is automatically served as
// the favicon (and app icon in browser tabs/bookmarks), no manual <link>
// tag or metadata wiring needed. Mirrors the brand mark already used
// elsewhere: the accent dot from .topbar-brand::before and the short
// signature-rule bar from .signature-rule (both in app/globals.css) —
// the only two elements of the mark that still read clearly at 32px.

import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const ACCENT = "#4b2bff";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
          borderRadius: 7,
        }}
      >
        <div
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: ACCENT,
            marginBottom: 3,
          }}
        />
        <div
          style={{
            width: 16,
            height: 3,
            borderRadius: 2,
            background: ACCENT,
          }}
        />
      </div>
    ),
    { ...size }
  );
}
