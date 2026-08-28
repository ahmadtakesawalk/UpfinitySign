// DEPLOY TO: app/signup/complete/page.tsx
//
// OAuth signup completion — the user has already proven who they are with
// Google or Microsoft. No form. The moment this page loads with a valid
// token, it fires the API call automatically and redirects to the
// dashboard. Workspace name is derived server-side from their email.
// The only state a visitor should ever see is "Setting up your workspace…"
// for the brief instant the API call is in flight, or an error if the
// token is invalid/expired.

"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SiteFooter } from "@/components/SiteFooter";

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

export default function CompleteSignupPage() {
  return (
    <Suspense fallback={<CenteredPage><p style={{ color: "var(--text-muted)" }}>Setting up your workspace…</p></CenteredPage>}>
      <AutoComplete />
    </Suspense>
  );
}

function AutoComplete() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("This link has expired — start over from the signup page.");
      return;
    }
    // No form, no user input — fire immediately. Workspace name is derived
    // server-side from the verified email address. If the user wants to
    // rename their workspace later they can do so in Settings.
    fetch("/api/dashboard/signup/oauth-complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
        router.push("/dashboard");
      })
      .catch((err) => setError(err.message));
  }, [token, router]);

  if (error) {
    return (
      <CenteredPage>
        <div className="card" style={{ width: 400, textAlign: "center" }}>
          <h2>Something went wrong</h2>
          <p style={{ color: "var(--danger)", fontSize: 14, marginBottom: 16 }}>{error}</p>
          <a href="/signup">Back to signup</a>
        </div>
      </CenteredPage>
    );
  }

  return (
    <CenteredPage>
      <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Setting up your workspace…</p>
    </CenteredPage>
  );
}
