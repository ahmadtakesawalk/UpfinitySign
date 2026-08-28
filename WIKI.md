# Upfinity Sign — Build Wiki

Technical reference for anyone picking up this codebase. For deployment/operations, see
`ADMIN_GUIDE.md`. For end-user-facing behavior, see `USER_FAQ.md`. For the original product
requirements and the reasoning behind early architecture decisions, see `PRD.md`.

## 1. Stack

Next.js 15 (App Router) / React 19 / TypeScript / Prisma + Postgres (Neon) / Vercel.

Every external capability (email, payments, storage, LLM, SSO) sits behind a provider-agnostic
interface with a config file listing registered providers — adding a new one means writing one
file that satisfies the interface, not touching call sites. This pattern repeats deliberately
across the codebase; look for a `providers.config.ts` next to any integration.

## 2. Domain model

Five tables carry the core product:

- **Tenant** — a workspace. Has a `tier` (free/starter/business/enterprise), optional custom
  branding, optional custom sending email domain (enterprise, admin-verified), optional Stripe
  Connect account (for payment fields).
- **Template** — a document + its field map (`fieldMap: Json`, an array of `FieldDefinition`, see
  `lib/signing/field-types.ts`). Can be `aiDrafted` (generated from a description, gated — see §5)
  and/or `selfServeEnabled` (public link, single-signer only, see §4).
- **Envelope** — one send. Belongs to a template, has recipients, a status, an optional
  `reminderAfterHoursOverride`, and (if AI-drafted-and-unreviewed) is blocked from being created at
  all — see the guard in `lib/signing/envelopes.ts`'s `createEnvelope`.
- **Recipient** — one person on one envelope. `accessTokenHash` (SHA-256, one-way, used for auth)
  and `accessTokenEncrypted` (AES-256-GCM, reversible, used ONLY to recover the link for reminders
  and in-person signing — never for auth).
- **AuditEvent** — append-only. Every send/open/sign/decline/failure, each with a human-readable
  `summary` generated at write time (`lib/signing/audit.ts`), not re-derived later by the UI.

Three completely separate auth systems, deliberately never sharing a code path:
`lib/tenant-auth.ts` (dashboard sessions), `lib/admin-auth.ts` (platform staff), `lib/auth.ts`
(per-tenant API keys). A fourth, `lib/oauth.ts`, sits in front of tenant auth for Google/Microsoft
sign-in — it verifies identity with the provider, then either creates a tenant session directly
(existing account) or hands off to a short "name your workspace" step via a signed, short-lived
token (new signup — OAuth doesn't supply a company name).

## 3. The signing pipeline

```
Upload (PDF or .docx) → field placement (AI-suggested or manual/assistant) → builder confirms
  → createEnvelope() → email sent → recipient opens /sign/[token]
  → fields rendered as overlays positioned on the actual rendered PDF pages
  → submit → server re-validates EVERYTHING independently of client input
  → finalizePdf() burns fields into the PDF + embeds a real PKI signature
  → generateCertificate() produces a separate Certificate of Completion PDF
```

Two documents come out of a completed envelope: the signed PDF itself (with fields burned in +
embedded signature) and a separate Certificate of Completion (chain of custody, styled as a formal
legal document — see `lib/signing/certificate.ts`). Certificate generation paginates correctly for
long audit trails — a real bug (silent page overflow) was found and fixed in this pass.

**Server-side validation is the actual trust boundary**, not the signing page's client-side checks
(`app/api/sign/[token]/route.ts`'s `validateSubmittedFields`): visibility (conditional fields),
required-ness, custom regex patterns, and — critically — payment field completion are all
re-derived server-side from the template's own field map and, for payments, an independently
verified Stripe webhook record. Nothing the client submits is trusted at face value for any of
these.

**Post-signature finalization is wrapped in error handling that tells the truth**: if PDF burning
or certificate generation fails after a signature is already recorded, the recipient is told their
signature succeeded and something else needs attention — never "something went wrong" implying
they need to sign again.

## 4. Field types

`lib/signing/field-types.ts` is the single source of truth. Standard set (signature, initial,
date, name/email auto-fill, company, title, text, number, checkbox, radio group, dropdown, note,
formula) plus three built specifically in this pass:

- **`attachment`** — recipient uploads a file; stored separately, never burned as raw text into
  the PDF (the field's stored value is a storage key, not displayable content).
- **`payment`** — see §9.
- **Conditional visibility** (`visibleIf`) isn't a field type but a property any field can carry:
  "show only if [other field] equals [value]." Deliberately one condition, not a rules engine —
  covers the real cases without the complexity of a general boolean expression system. Evaluated
  identically client-side (UX) and server-side (enforcement) — see `isFieldVisible`.

Self-serve links (public, single-signer, `app/self-serve/[token]`) are refused for any template
with more than one distinct recipient role — there's no sensible way for an anonymous visitor to
supply a second recipient's details.

## 5. The AI subsystem

Three surfaces, one backend pattern: prompt the model to return strict JSON (matching the
established `field-placement.ts` pattern), parse it, never trust native tool-calling protocols
that would need separate maintenance across providers.

- **Field placement on upload** (`lib/llm/field-placement.ts`) — proposes fields from extracted
  PDF/docx text, sender confirms in the builder.
- **The assistant** (`lib/llm/assistant.ts`, `components/assistant/AssistantChatPanel.tsx`) — chat
  panel in the template builder. Edits fields on an existing template, or drafts a whole new
  document from a description. Every response is a `reply` (always shown) plus at most one
  `action` (a proposal, never auto-applied).
- **Account Q&A** — read-only, kept in a completely separate function
  (`answerAccountQuestion`) so it can never accidentally return a field/document action.

**The review gate on AI-generated documents is enforced at the source, not just hidden in the
UI.** A generated `Template` is created with `aiDrafted: true` and no `aiReviewedAt`.
`createEnvelope` itself throws if that's still true — so no path (dashboard, bulk send, the
external API) can slip an unreviewed AI-drafted document through. The UI additionally disables it
in the envelope-creation dropdown and shows a persistent banner, but those are conveniences on top
of the real enforcement point.

## 6. Billing & credits

`lib/billing/`: tier limits live only in `lib/config.ts`'s `config.tiers` (pricing changes are a
config edit, never a code change). Two metered items with monthly allowances —
`envelopes_sent` and `ai_messages` — each falls back to purchased credits once the plan allowance
is exhausted (`lib/billing/metering.ts`'s `assertWithinLimitOrCredit`, atomic via a
conditional `updateMany` so concurrent requests can't both consume the same last credit).

Payment provider abstraction (`lib/billing/payment-provider.ts`) handles two distinct checkout
shapes — a recurring tier subscription and a one-time credit-pack purchase — via a discriminated
`kind` field, both implemented for Stripe. Paddle is registered but intentionally not implemented
(the comment in `lib/billing/providers/paddle.ts` explains why: a real product-UX decision, not a
missing credential).

## 7. Payment collection (payment fields)

Completely separate system from tenant billing above, on purpose: `lib/signing/payment.ts` uses
Stripe **Connect**, not the platform's own Stripe account, so money a tenant collects from *their*
customer during signing goes to the *tenant's own* connected account. Routing it through the
platform's account instead would be a real accounting/legal problem, not just an architecture
preference.

Two Stripe webhook endpoints exist and are kept deliberately separate: `/api/webhooks/stripe`
(platform billing) and `/api/webhooks/stripe-connect` (tenant payment collection + Connect account
onboarding status). Configure them as two separate webhook endpoints in the Stripe Dashboard with
different secrets — merging them into one handler would make it possible to cross-wire a billing
event with payment money.

A payment field is never satisfiable by a submitted string value — `validateSubmittedFields`
checks `isFieldPaid()` against the `EnvelopePayment` table, which only a verified webhook can
update.

## 8. Email

`lib/email.ts`: Resend (primary) → Gmail SMTP (fallback, only activates if Resend fails or isn't
configured) → dev console-log (final fallback, keeps local dev testable with nothing configured).
From-address resolution checks whether the tenant is enterprise-tier with an admin-*verified*
custom domain (`Tenant.customFromEmail` + `customFromEmailVerifiedAt`, two separate fields — a
tenant setting the address alone only requests it, never activates it) before falling back to the
platform default.

## 9. Audit & compliance posture

Two separate audit systems, intentionally not merged:
- **`AuditEvent`** (`lib/signing/audit.ts`) — envelope/recipient activity, every tenant, viewable
  platform-wide at `/admin/audit`. Includes four failure states
  (`email_failed`/`signing_validation_failed`/`finalization_failed`/`attachment_upload_failed`)
  that didn't exist before this pass — previously these only reached server logs, never the
  durable trail a compliance reviewer or support ticket would check.
- **`AdminAuditLog`** — platform staff actions only (tier changes, suspensions, staff
  invites/removals). "Who on our team touched what," not product activity.

**What's genuinely encrypted vs. what relies on infrastructure**: recipient access tokens, SSO
client secrets, and API keys are encrypted/hashed at the application layer. Ordinary PII (names,
emails, IP addresses) relies on the database provider's disk-level encryption at rest (standard
for managed Postgres) rather than blanket per-column application encryption — deliberately, since
the latter would be real over-engineering for this data class without a proportional compliance
requirement driving it. TLS in transit to the database is enforced at boot (`lib/db.ts` refuses to
start without `sslmode=require`).

**SOC 2 and live-tested SSO are not represented as done anywhere in this codebase or its docs** —
the former is a third-party audit process, the latter has real, working SAML code
(`lib/jackson.ts`) that has never been run against an actual Okta/Azure AD tenant.

## 10. Design system

`app/globals.css` — neutral paper/ink base with one deliberate bright accent (electric indigo,
`#4b2bff`), chosen specifically to avoid the near-universal "AI-generated" cream/terracotta
palette. `lib/motion/tokens.ts` + `components/motion/` — spring-based (not CSS-easing) motion
primitives (Button, Card, Toast, Skeleton) used product-wide via shared components, not
per-page-reinvented.

## 11. Integration surface

- **`/api/v1/*`** — external API, per-tenant key auth. This is what Upfinity Talent (or any other
  integration) calls: `POST /api/v1/envelopes` with `template_id`, `recipients[]`, and
  `external_ref` (e.g. a Talent candidate ID) to correlate on the other end.
- **Webhooks** (`lib/webhooks/dispatch.ts`) — HMAC-signed, fire on every envelope status change.
  This is how Talent (or anything else) learns a document was signed without polling.
- **`/api/dashboard/*`** mirrors `/api/v1/*` functionally but session-authed — what the dashboard
  UI itself calls. Both paths funnel through the same `lib/signing/*` logic; there is one source of
  truth for envelope/template behavior regardless of entry point.

See **[INTEGRATIONS.md](./INTEGRATIONS.md)** for the full contract — exact payload shapes, the
real event types that fire (there's no per-recipient "opened"/"signed" webhook, only envelope-level
transitions), webhook signature verification, and a concrete walkthrough of what a "Send Offer
Letter" button inside Upfinity Talent's own UI actually does end to end.

## 12. Known gaps

Tracked plainly rather than glossed over — see `ADMIN_GUIDE.md` §9 for operational symptoms of
these, and `README.md` for anything narrower/file-specific:

- SOC 2 certification, live-tested SSO against a real IdP (both above)
- Notarization, native mobile apps, native Salesforce/Drive/O365 connectors — not built; each is
  its own large feature or external partnership
- No manual/human QA pass on a live deployment has been performed from this side — everything here
  is verified via TypeScript compilation and logical review, which is real but not a substitute
  for click-through testing on production infrastructure with real provider credentials
