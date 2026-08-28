// DEPLOY TO: components/WebhookRetryButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/motion/Toast";
import { Button } from "@/components/motion/Button";
import { Spinner } from "@/components/motion/Spinner";

export function WebhookRetryButton({ deadLetterId }: { deadLetterId: string }) {
  const { show } = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/webhook-activity/${deadLetterId}/retry`, { method: "POST" });
      if (res.status === 401) return router.push("/dashboard/login");
      const json = await res.json();
      if (!res.ok || !json.success) {
        show({ message: json.error ?? "Still couldn't get through — your integration may still be down.", type: "error" });
        return;
      }
      show({ message: "Delivered successfully.", type: "success" });
      router.refresh();
    } catch {
      show({ message: "Network error — try again.", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="secondary" onClick={handleClick} disabled={loading} style={{ fontSize: 12, padding: "5px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}>
      {loading ? (
        <>
          <Spinner size={12} color="var(--text-secondary)" /> Retrying…
        </>
      ) : (
        <>
          <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2.5v3.5h-3.5" />
          </svg>
          Try again
        </>
      )}
    </Button>
  );
}
