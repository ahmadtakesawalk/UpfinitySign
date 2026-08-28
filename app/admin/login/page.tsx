"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteFooter } from "@/components/SiteFooter";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) router.push("/admin");
    else setError("Incorrect email or password.");
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={handleSubmit} className="card" style={{ width: 360 }}>
        <h2>Upfinity Sign — Admin</h2>
        <div className="signature-rule" />
        {error && <p style={{ color: "#a32d2d", fontSize: 13 }}>{error}</p>}
        <div style={{ marginBottom: 12 }}>
          <input
            type="email"
            placeholder="you@upfinity.ca"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="primary" style={{ width: "100%" }}>
          Sign in
        </button>
      </form>
      </div>
      <SiteFooter />
    </div>
  );
}
