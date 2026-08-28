// DEPLOY TO: components/CancelPlanButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/motion/Button";

export function CancelPlanButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/billing/cancel", { method: "POST" });
      if (res.status === 401) return router.push("/dashboard/login");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setDone(true);
      setConfirming(false);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setCancelling(false);
    }
  }

  if (done) {
    return <p style={{ fontSize: 13, color: "var(--success)", marginTop: 12 }}>Your plan is set to cancel at the end of the current billing period — you'll keep full access until then, and won't be charged again.</p>;
  }

  if (confirming) {
    return (
      <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", background: "var(--bg-subtle)" }}>
        <p style={{ fontSize: 13, marginBottom: 10 }}>
          This cancels at the end of your current billing period — you keep full access until then and won't be charged again. Not immediate, nothing is lost.
        </p>
        {error && <p style={{ fontSize: 12.5, color: "var(--danger)", marginBottom: 10 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={cancelling}>Never mind</Button>
          <Button variant="danger" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Confirm cancellation"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button variant="secondary" style={{ marginTop: 12 }} onClick={() => setConfirming(true)}>
      Cancel plan
    </Button>
  );
}
