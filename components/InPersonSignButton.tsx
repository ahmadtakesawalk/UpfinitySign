// DEPLOY TO: components/InPersonSignButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/motion/Toast";

export function InPersonSignButton({ envelopeId, recipientId }: { envelopeId: string; recipientId: string }) {
  const { show } = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function fetchLink(): Promise<string | null> {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/envelopes/${envelopeId}/recipients/${recipientId}/link`);
      if (res.status === 401) { router.push("/dashboard/login"); return null; }
      const json = await res.json();
      if (!res.ok) {
        show({ message: json.error ?? "Couldn't get this recipient's link.", type: "error" });
        return null;
      }
      return json.url;
    } catch {
      show({ message: "Network error — try again.", type: "error" });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function openInPerson() {
    const url = await fetchLink();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  async function copyLink() {
    const url = await fetchLink();
    if (url) {
      await navigator.clipboard.writeText(url);
      show({ message: "Signing link copied.", type: "success" });
    }
  }

  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button type="button" onClick={openInPerson} disabled={loading} style={{ fontSize: 12, background: "none", border: "none", color: "var(--accent-dark)", cursor: "pointer", padding: 0, fontWeight: 500 }}>
        Sign in person
      </button>
      <span style={{ color: "var(--border-strong)" }}>·</span>
      <button type="button" onClick={copyLink} disabled={loading} style={{ fontSize: 12, background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 0 }}>
        Copy link
      </button>
    </div>
  );
}
