// DEPLOY TO: app/dashboard/login/page.tsx
"use client";

// Single-screen sign-in: email + password entered together, one submit.
// Workspace lookup happens on submit — if the account belongs to exactly
// one workspace (the overwhelming majority case), login completes
// immediately with no extra screen. The workspace-picker step only
// appears for the rare multi-workspace account, and re-uses the password
// already typed rather than asking for it twice.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/motion/Button";
import { SiteFooter } from "@/components/SiteFooter";

interface WorkspaceOption {
  slug: string;
  name: string;
}

type Step = "form" | "workspace_picker";

export default function DashboardLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function performLogin(workspaceSlug: string) {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace: workspaceSlug, email, password }),
      });
      if (res.ok) {
        router.push("/dashboard");
      } else {
        setError("Incorrect email or password.");
        setLoading(false);
      }
    } catch {
      setError("Network error — please try again.");
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/login/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      const found: WorkspaceOption[] = json.workspaces ?? [];

      if (found.length === 0) {
        // Same email/workspace combo will still fail cleanly on the actual
        // login attempt if this is wrong — this isn't a security boundary,
        // just a UX nicety (the real login endpoint still returns a
        // generic "invalid credentials" either way).
        setError("No account found with that email. Check the address, or create a free account.");
        setLoading(false);
        return;
      }
      if (found.length > 1) {
        setWorkspaces(found);
        setStep("workspace_picker");
        setLoading(false);
        return;
      }
      await performLogin(found[0].slug);
    } catch {
      setError("Network error — please try again.");
      setLoading(false);
    }
  }

  function startOver() {
    setStep("form");
    setWorkspaces([]);
    setError(null);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="card" style={{ width: 380, borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
          <h2>Sign in</h2>
          <div className="signature-rule" />
          {error && <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{error}</p>}

          {step === "form" && (
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 12 }}>
                <label className="field-label">Email</label>
                <input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label className="field-label">Password</label>
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" variant="primary" style={{ width: "100%" }} disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>

              <a href="/dashboard/forgot-password" style={{ display: "block", textAlign: "center", marginTop: 12, fontSize: 13, color: "var(--text-secondary)" }}>
                Forgot password?
              </a>

              <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                <a href="/api/auth/google" style={{ textDecoration: "none" }}>
                  <Button type="button" variant="secondary" style={{ width: "100%" }}>Continue with Google</Button>
                </a>
                <a href="/api/auth/microsoft" style={{ textDecoration: "none" }}>
                  <Button type="button" variant="secondary" style={{ width: "100%" }}>Continue with Microsoft</Button>
                </a>
              </div>
            </form>
          )}

          {step === "workspace_picker" && (
            <div>
              <p style={{ fontSize: 13, marginBottom: 12 }}>
                {email} belongs to more than one workspace — which one?
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {workspaces.map((w) => (
                  <Button
                    key={w.slug}
                    variant="secondary"
                    style={{ textAlign: "left", padding: "10px 12px" }}
                    disabled={loading}
                    onClick={() => performLogin(w.slug)}
                  >
                    {w.name} <span style={{ color: "var(--text-muted)", fontSize: 12 }}>({w.slug})</span>
                  </Button>
                ))}
              </div>
              <button type="button" onClick={startOver} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: 13, cursor: "pointer", padding: 0 }}>
                ← Use a different email
              </button>
            </div>
          )}

          <p style={{ fontSize: 13, textAlign: "center", marginTop: 16 }}>
            New here? <a href="/signup">Create a free account</a>
          </p>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
