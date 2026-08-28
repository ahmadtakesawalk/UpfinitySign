// DEPLOY TO: components/SendReminderButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/motion/Toast";

export function SendReminderButton({ envelopeId, recipientId }: { envelopeId: string; recipientId: string }) {
  const { show } = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/envelopes/${envelopeId}/recipients/${recipientId}/send-reminder`, { method: "POST" });
      if (res.status === 401) return router.push("/dashboard/login");
      const json = await res.json();
      if (!res.ok) {
        show({ message: json.error ?? "Couldn't send the reminder.", type: "error" });
        return;
      }
      show({ message: "Reminder sent.", type: "success" });
    } catch {
      show({ message: "Network error — try again.", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={loading} style={{ fontSize: 12, background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 0 }}>
      {loading ? "Sending…" : "Send reminder now"}
    </button>
  );
}
