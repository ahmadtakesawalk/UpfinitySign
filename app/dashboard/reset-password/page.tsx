"use client";

// useSearchParams() requires a Suspense boundary or Next.js fails the
// build with "useSearchParams() should be wrapped in a suspense boundary".

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/motion/Button";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<CenteredCard><div className="card" style={{ width: 360, textAlign: "center" }}><p>Loading…</p></div></CenteredCard>}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("Passwords don't match.");
    if (!token) return setError("Missing reset token.");
    const res = await fetch("/api/dashboard/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword: password }),
    });
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? "Something went wrong.");
    setDone(true);
    setTimeout(() => router.push("/dashboard/login"), 2000);
  }

  if (done) {
    return <CenteredCard><div className="card" style={{ width: 360, textAlign: "center" }}><h2>Password updated</h2><p>Redirecting you to sign in…</p></div></CenteredCard>;
  }

  return (
    <CenteredCard>
      <form onSubmit={handleSubmit} className="card" style={{ width: 360 }}>
        <h2>Set a new password</h2>
        <div className="signature-rule" />
        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
        <div style={{ marginBottom: 12 }}>
          <input type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <input type="password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        <Button type="submit" variant="primary" style={{ width: "100%" }}>Update password</Button>
      </form>
    </CenteredCard>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
      <SiteFooter />
    </div>
  );
}
