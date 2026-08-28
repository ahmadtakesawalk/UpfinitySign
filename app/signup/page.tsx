"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/motion/Button";
import { SiteFooter } from "@/components/SiteFooter";

export default function SignupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/dashboard/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName, email, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={handleSubmit} className="card" style={{ width: 400 }}>
        <div className="topbar-brand" style={{ marginBottom: 16 }}>Upfinity Sign</div>
        <h2>Create your free account</h2>
        <p style={{ fontSize: 13, marginBottom: 4 }}>No credit card required to start.</p>
        <div className="signature-rule" />

        {error && <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <div style={{ marginBottom: 12 }}>
          <label className="field-label">Company name <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span></label>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Inc." />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label className="field-label">Work email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label className="field-label">Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>

        <Button type="submit" variant="primary" style={{ width: "100%" }} disabled={submitting}>
          {submitting ? "Creating your workspace…" : "Create Free Account"}
        </Button>

        <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <a href="/api/auth/google" style={{ textDecoration: "none" }}>
            <Button type="button" variant="secondary" style={{ width: "100%" }}>Continue with Google</Button>
          </a>
          <a href="/api/auth/microsoft" style={{ textDecoration: "none" }}>
            <Button type="button" variant="secondary" style={{ width: "100%" }}>Continue with Microsoft</Button>
          </a>
        </div>

        <p style={{ fontSize: 13, textAlign: "center", marginTop: 16 }}>
          Already have a workspace? <a href="/dashboard/login">Sign in</a>
        </p>
        <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 12 }}>
          By creating an account, you agree to our <a href="/terms">Terms of Service</a> and{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </form>
      </div>
      <SiteFooter />
    </div>
  );
}
