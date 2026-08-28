// DEPLOY TO: app/page.tsx
"use client";

import { motion, useReducedMotion } from "framer-motion";
import { springs } from "@/lib/motion/tokens";
import { SignatureMark } from "@/components/marketing/SignatureMark";
import { Card } from "@/components/motion/Card";
import { Button } from "@/components/motion/Button";
import { Reveal } from "@/components/motion/Reveal";

const FEATURES = [
  { title: "Send in minutes", body: "Upload a document, drop fields where they belong, and send. No template required for a one-off — or save it as one for next time." },
  { title: "AI-suggested fields", body: "Upload a document and get signature, date, and text fields proposed automatically from what's actually on the page. Confirm or adjust before sending." },
  { title: "Built-in audit trail", body: "Every open, view, and signature is logged with a timestamp, IP address, and location — bundled into a Certificate of Completion with each finished envelope." },
  { title: "Real PKI signatures", body: "Signed documents carry an embedded, tamper-evident digital signature — not just a database record that says 'signed'." },
  { title: "Team workspaces", body: "Invite your team, assign roles, and manage who can send, view, and administer — all scoped to your workspace." },
  { title: "API & webhooks", body: "Everything in the product is also available as an API, with webhooks pushing status updates the moment something changes." },
];

const STEPS = [
  { title: "Upload your document", body: "Drop in a PDF — offer letters, NDAs, contracts, policy acknowledgments, anything that needs a signature." },
  { title: "Place your fields", body: "We suggest where signatures, dates, and other fields belong. Adjust anything, add what's missing." },
  { title: "Send to your recipients", body: "Add names and emails, set a signing order if it matters, and send. Each person gets a secure, no-login-required link." },
  { title: "Track it to completion", body: "Watch status update in real time, and get a Certificate of Completion the moment everyone's signed." },
];

const FAQS = [
  { q: "Do my recipients need an account?", a: "No. Anyone you send a document to signs through a secure link — no login, no account creation." },
  { q: "Is a signature made here legally binding?", a: "Yes. Every signature is captured with full audit metadata (timestamp, IP address, verification method) and the signed document carries an embedded digital signature." },
  { q: "Can I use my own branding?", a: "Yes, on eligible plans — replace the default header on your recipients' signing pages with your own logo." },
  { q: "What happens to my data if I leave?", a: "You can export your full workspace data at any time from Settings, and request deletion whenever you'd like." },
  { q: "Do you have an API?", a: "Yes — every core action (creating envelopes, checking status, managing templates) is available via API, with webhooks for status changes." },
];

export default function LandingPage() {
  const reduceMotion = useReducedMotion();
  const heroUp = (delay: number) => (reduceMotion ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { ...springs.standard, delay } });

  return (
    <>
      <div className="topbar">
        <a href="/" className="topbar-brand">Upfinity Sign</a>
        <nav className="topbar-nav" style={{ alignItems: "center", gap: 16 }}>
          <a href="#features">Product</a>
          <a href="#security">Security</a>
          <a href="#faq">FAQ</a>
          <a href="/dashboard/login">Sign in</a>
          <a href="/signup" style={{ textDecoration: "none" }}>
            <Button variant="primary" style={{ padding: "8px 18px", fontSize: 13 }}>Create free account</Button>
          </a>
        </nav>
      </div>

      {/* Hero — soft blurred gradient glow behind the content for depth/
          contrast (not a solid gradient wash like the dashboard banner —
          text here stays dark-on-light, so this is a backdrop accent, not
          a background swap), plus a staggered fade-up entrance instead of
          everything appearing at once. */}
      <section className="hero-section" style={{ position: "relative", overflow: "hidden" }}>
        <div
          aria-hidden
          style={{
            position: "absolute", top: "-30%", left: "50%", transform: "translateX(-50%)",
            width: 720, height: 480, borderRadius: "50%",
            background: "var(--hero-gradient)", opacity: 0.16, filter: "blur(90px)",
            pointerEvents: "none", zIndex: 0,
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <motion.span className="hero-eyebrow" {...heroUp(0)}>E-signature, built for how teams actually send</motion.span>
          <motion.div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }} {...heroUp(0.05)}>
            <SignatureMark />
          </motion.div>
          <motion.h1 className="hero-headline" {...heroUp(0.1)}>Send it. Get it signed. Move on.</motion.h1>
          <motion.p className="hero-sub" {...heroUp(0.15)}>
            Upfinity Sign gets documents from draft to signed with an audit trail that holds up —
            without the per-seat markup of legacy e-signature tools.
          </motion.p>
          <motion.div className="hero-ctas" {...heroUp(0.2)}>
            <a href="/signup" style={{ textDecoration: "none" }}>
              <Button variant="primary" style={{ padding: "14px 28px", fontSize: 15 }}>Create free account</Button>
            </a>
            <a href="/dashboard/login" style={{ textDecoration: "none" }}>
              <Button variant="secondary" style={{ padding: "14px 28px", fontSize: 15 }}>Sign in</Button>
            </a>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="marketing-section tight" id="features">
        <Reveal><p className="section-eyebrow">What you get</p></Reveal>
        <Reveal index={1}><h2>Everything a signing workflow needs, nothing it doesn't</h2></Reveal>
        <div className="feature-grid">
          {FEATURES.map((f, i) => (
            <Card key={f.title} index={i} hoverable revealOnScroll>
              <h3 style={{ marginBottom: 8 }}>{f.title}</h3>
              <p style={{ fontSize: 14 }}>{f.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works — a real sequence, so numbering earns its place here */}
      <section className="marketing-section">
        <Reveal><p className="section-eyebrow">How it works</p></Reveal>
        <Reveal index={1}><h2>From upload to signed, in order</h2></Reveal>
        <div style={{ marginTop: 24 }}>
          {STEPS.map((s, i) => (
            <Reveal index={i} key={s.title}>
              <div className="step-row">
                <span className="step-number">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 style={{ marginBottom: 4 }}>{s.title}</h3>
                  <p style={{ fontSize: 14 }}>{s.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Security / trust — tinted full-bleed strip so it reads as a
          distinct block scrolling down, instead of blending into the flat
          white of every section around it. */}
      <div style={{ background: "var(--bg-subtle)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <section className="marketing-section" id="security">
          <Reveal><p className="section-eyebrow">Security & compliance</p></Reveal>
          <Reveal index={1}><h2>Defensible from the first envelope</h2></Reveal>
          <div className="feature-grid">
            <Card index={0} hoverable revealOnScroll>
              <h3 style={{ marginBottom: 8 }}>Tamper-evident signatures</h3>
              <p style={{ fontSize: 14 }}>Every signed PDF carries a real embedded digital signature, not just a database flag.</p>
            </Card>
            <Card index={1} hoverable revealOnScroll>
              <h3 style={{ marginBottom: 8 }}>Full chain of custody</h3>
              <p style={{ fontSize: 14 }}>Every view, open, and signature is logged with timestamp, IP address, and location — bundled into a Certificate of Completion.</p>
            </Card>
            <Card index={2} hoverable revealOnScroll>
              <h3 style={{ marginBottom: 8 }}>Workspace isolation</h3>
              <p style={{ fontSize: 14 }}>Every account is scoped to its own workspace — your documents and data never mix with anyone else's.</p>
            </Card>
          </div>
        </section>
      </div>

      {/* API / integration — dark panel breaks the white/tint rhythm once,
          the way a dev-focused section usually reads (terminal-adjacent),
          rather than repeating the same light card style a third time. */}
      <section className="marketing-section tight">
        <Reveal><p className="section-eyebrow">For developers</p></Reveal>
        <Reveal index={1}><h2>Built for teams and integrations alike</h2></Reveal>
        <Reveal index={2}>
          <div style={{ background: "var(--text-primary)", color: "#fff", borderRadius: "var(--radius-sm)", padding: "24px 28px", maxWidth: 680 }}>
            <p style={{ margin: 0, color: "rgba(255,255,255,0.85)" }}>
              Everything you can do in the product — sending envelopes, managing templates, checking
              status — is also available as an API, with HMAC-signed webhooks so your own systems stay
              in sync automatically.
            </p>
          </div>
        </Reveal>
      </section>

      {/* FAQ */}
      <section className="marketing-section" id="faq">
        <Reveal><p className="section-eyebrow">Questions</p></Reveal>
        <Reveal index={1}><h2>Frequently asked</h2></Reveal>
        <div style={{ marginTop: 16 }}>
          {FAQS.map((f, i) => (
            <Reveal index={i} key={f.q}>
              <details className="faq-item">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
        <p style={{ marginTop: 16 }}>
          <a href="/faq">See all FAQs →</a>
        </p>
      </section>

      {/* Final CTA */}
      <div className="cta-band">
        <h2>Ready to send your first envelope?</h2>
        <p style={{ marginBottom: 24 }}>Create a free workspace — no card required.</p>
        <a href="/signup" style={{ textDecoration: "none" }}>
          <Button variant="primary" style={{ padding: "14px 28px", fontSize: 15 }}>Create free account</Button>
        </a>
      </div>

      <div className="footer-note">
        Upfinity Sign — a product of <a href="https://upfinity.ca">Upfinity Inc.</a> · <a href="/dashboard/login">Sign in</a>
        {" · "}
        <a href="/privacy">Privacy Policy</a>
        {" · "}
        <a href="/terms">Terms of Service</a>
      </div>
    </>
  );
}
