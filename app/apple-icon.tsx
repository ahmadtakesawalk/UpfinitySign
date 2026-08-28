// DEPLOY TO: app/apple-icon.tsx
// Next.js App Router convention — served automatically for "Add to Home
// Screen" / bookmarks on iOS/Safari. Same mark as app/icon.tsx, scaled up
// (180x180 is Apple's standard size) so it stays crisp there too.

import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const ACCENT = "#4b2bff";

export default function AppleIcon() {
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
          borderRadius: 40,
        }}
      >
        <div
          style={{
            width: 50,
            height: 50,
            borderRadius: "50%",
            background: ACCENT,
            marginBottom: 16,
          }}
        />
        <div
          style={{
            width: 90,
            height: 16,
            borderRadius: 8,
            background: ACCENT,
          }}
        />
      </div>
    ),
    { ...size }
  );
}
