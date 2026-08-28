// DEPLOY TO: app/dashboard/forgot-password/page.tsx
"use client";

import { useState } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/motion/Button";

function CenteredPage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
      <SiteFooter />
    </div>
  );
}

interface WorkspaceOption {
  slug: string;
  name: string;
}

// Same email-first pattern as the login page now uses — reuses the exact
// same lookup endpoint. Previously this page asked for "Workspace" as a
// free-text field upfront, same inconsistent UX the login page had before
// its own fix; this brings the two back in sync.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function sendReset(workspace: string) {
    setLoading(true);
    await fetch("/api/dashboard/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace, email }),
    });
    setSent(true); // always show the same confirmation — see the route's comment on why
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
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
        // Still show the generic "check your email" confirmation — this
        // page's whole point is not confirming/denying account existence,
        // so a zero-match lookup result must look identical to a
        // successful send from the outside.
        setSent(true);
      } else if (found.length === 1) {
        await sendReset(found[0].slug);
      } else {
        setWorkspaces(found);
        setShowPicker(true);
        setLoading(false);
      }
    } catch {
      // Even a network error here shouldn't reveal anything — fail into
      // the same generic confirmation rather than showing an error state
      // that behaves differently from the success path.
      setSent(true);
    }
  }

  if (sent) {
    return (
      <CenteredPage>
        <div className="card" style={{ width: 360, textAlign: "center" }}>
          <h2>Check your email</h2>
          <p>If that account exists, a reset link is on its way.</p>
          <a href="/dashboard/login">Back to login</a>
        </div>
      </CenteredPage>
    );
  }

  return (
    <CenteredPage>
      <div className="card" style={{ width: 360 }}>
        <h2>Reset password</h2>
        <div className="signature-rule" />

        {!showPicker ? (
          <form onSubmit={handleEmailSubmit}>
            <div style={{ marginBottom: 16 }}>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <Button type="submit" variant="primary" style={{ width: "100%" }} disabled={loading}>
              {loading ? "Checking…" : "Send reset link"}
            </Button>
            <a href="/dashboard/login" style={{ display: "block", textAlign: "center", marginTop: 12, fontSize: 13, color: "var(--text-secondary)" }}>
              Back to login
            </a>
          </form>
        ) : (
          <div>
            <p style={{ fontSize: 13, marginBottom: 12 }}>
              {email} belongs to more than one workspace — which one needs a reset?
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {workspaces.map((w) => (
                <Button
                  key={w.slug}
                  variant="secondary"
                  style={{ textAlign: "left", padding: "10px 12px" }}
                  onClick={() => sendReset(w.slug)}
                  disabled={loading}
                >
                  {w.name} <span style={{ color: "var(--text-muted)", fontSize: 12 }}>({w.slug})</span>
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </CenteredPage>
  );
}
