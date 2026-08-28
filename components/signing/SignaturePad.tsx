// DEPLOY TO: components/signing/SignaturePad.tsx
"use client";

// Native HTML5 canvas signature capture — no external drawing library
// needed. Exports the stroke as a transparent-background PNG data URL,
// which lib/signing/pdf.ts embeds directly onto the document at sign time
// (see embedPkiSignature / burnFields — image values are detected by the
// "data:image" prefix and drawn as an image, not text).

import { useRef, useState, useEffect } from "react";

export function SignaturePad({ onChange, height = 120 }: { onChange: (dataUrl: string) => void; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [hasStroke, setHasStroke] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "#14151a";
    }
  }, []);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    lastPoint.current = getPoint(e);
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !lastPoint.current) return;
    const point = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPoint.current = point;
    setHasStroke(true);
  }

  function end() {
    drawing.current = false;
    lastPoint.current = null;
    const canvas = canvasRef.current;
    if (canvas && hasStroke) onChange(canvas.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
    onChange("");
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        style={{
          width: "100%",
          height,
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-sm)",
          background: "#fff",
          touchAction: "none",
          cursor: "crosshair",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>Draw your signature above</p>
        <button type="button" onClick={clear} style={{ background: "none", border: "none", color: "var(--accent-dark)", fontSize: 12, cursor: "pointer", padding: 0 }}>
          Clear
        </button>
      </div>
    </div>
  );
}
