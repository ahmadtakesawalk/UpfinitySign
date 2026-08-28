// DEPLOY TO: app/admin/set-password/page.tsx
"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SiteFooter } from "@/components/SiteFooter";

export default function AdminSetPasswordPage() {
  return (
    <Suspense fallback={<CenteredCard><div className="card" style={{ width: 360, textAlign: "center" }}><p>Loading…</p></div></CenteredCard>}>
      <SetPasswordForm />
    </Suspense>
  );
}

function SetPasswordForm() {
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
    if (!token) return setError("Missing invite token.");
    const res = await fetch("/api/admin/set-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword: password }),
    });
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? "Something went wrong.");
    setDone(true);
    setTimeout(() => router.push("/admin/login"), 2000);
  }

  if (done) {
    return <CenteredCard><div className="card" style={{ width: 360, textAlign: "center" }}><h2>Password set</h2><p>Redirecting you to sign in…</p></div></CenteredCard>;
  }

  return (
    <CenteredCard>
      <form onSubmit={handleSubmit} className="card" style={{ width: 360 }}>
        <h2>Set your admin password</h2>
        <div className="signature-rule" />
        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
        <div style={{ marginBottom: 12 }}>
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <input type="password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        <button type="submit" className="primary" style={{ width: "100%" }}>Set password</button>
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
