# Upfinity Sign — Codebase Wiki

Purpose: find the right file fast, and know what else touches it before you
change it. Not a tutorial — a map.

---

## 1. Stack & shape

Next.js (App Router) + TypeScript + Prisma/Postgres. `app/` is both pages
and API routes (`app/api/**/route.ts`). No separate backend service.

Three surfaces, three auth systems — don't cross them:
| Surface | Auth | Entry |
|---|---|---|
| Tenant dashboard | `lib/tenant-auth.ts` (session cookie) | `app/dashboard/**` |
| Platform admin | `lib/admin-auth.ts` (separate session) | `app/admin/**` |
| Public signing | possession of a signed token, no login | `app/sign/[token]`, `app/self-serve/[token]` |
| External API | `lib/auth.ts` (API key + scopes) | `app/api/v1/**` |

---

## 2. Request flow, top to bottom

1. **Sender** builds a `Template` (upload PDF → fields placed, either by
   hand or AI-assisted) in `app/dashboard/templates/[id]/page.tsx`.
2. Sender creates an `Envelope` from that template + recipients —
   `app/dashboard/envelopes/new/page.tsx` → `POST /api/dashboard/envelopes`
   → sends immediately (there's no separate "draft then send" step; see
   §7 gotchas).
3. **Recipient** opens `app/sign/[token]/page.tsx`, backed by
   `app/api/sign/[token]/route.ts`. Fields render via the shared
   `components/signing/FieldRenderer.tsx` (see §4).
4. On completion: `lib/signing/pdf.ts` burns field values into the PDF,
   `lib/signing/certificate.ts` generates the Certificate of Completion,
   webhooks fire (`lib/webhooks/dispatch.ts`), confirmation email sends.
5. Sender can re-open `app/dashboard/envelopes/[id]/fields/page.tsx` to
   edit fields on an **already-sent, still-active** envelope (locked once
   completed/declined/voided/expired).

---

## 3. Directory map

```
app/
  dashboard/            tenant-facing pages (Envelopes, Templates, Settings, Team lives inside Settings)
    envelopes/[id]/fields/    the envelope field editor (post-send editing)
    templates/[id]/           the template field editor (pre-send, has Quick Edit + Assistant)
  sign/[token]/          public signing page
  self-serve/[token]/    public self-serve template flow (fill-your-own-details link)
  certificates/[id]/     public Certificate of Completion view
  admin/                 platform-staff-only tools (billing overrides, tenant management, audit log)
  api/
    dashboard/**         tenant-authed endpoints, called by app/dashboard pages
    admin/**             admin-authed endpoints
    sign/[token]/**      public, token-authed (OTP verify, attachment upload, payment)
    v1/**                external API-key-authed (what integration partners use)
    webhooks/**          inbound webhooks FROM Stripe etc. (not outbound — see lib/webhooks/dispatch.ts for outbound)
    cron/**              scheduled jobs (trial processing, reminders, retention purge)

lib/
  signing/               the actual document engine — see §5
  billing/               subscription/invoicing/refunds — see §5
  llm/                   AI field-placement + in-editor assistant
  motion/tokens.ts        shared animation constants (springs, stagger) — see §4
  tenant-auth.ts / admin-auth.ts / auth.ts   the three auth systems from §1

components/
  motion/                shared UI primitives — see §4
  signing/               FieldRenderer.tsx, SignaturePad.tsx — shared between live signing + Preview
  <flat files>           one-off cards used from Settings (TeamCard, ApiKeysCard, SecurityCard, etc.)

prisma/schema.prisma     single source of truth for all data shapes — see §6
```

---

## 4. Shared components — check here before duplicating anything

| File | Used by | Note |
|---|---|---|
| `components/motion/Button.tsx` | Should be **every** primary/secondary/danger button app-wide | Drop-in for `<button className="primary">` — same CSS classes, adds spring press/hover. Some raw `<button>`s remain by design: tab/segmented-control switchers (Preview device toggle, FAQ category tabs), inline text-links, high-repeat nav (pagination, folder lists) — see the motion skill's frequency guidance for why those stay plain. |
| `components/motion/Card.tsx` | Dashboard cards, marketing sections | `revealOnScroll` prop: opt-in scroll-triggered reveal for below-the-fold marketing content; default is mount-fade for above-the-fold/dashboard content. Don't use `revealOnScroll` on dashboard content people see immediately. |
| `components/motion/Reveal.tsx` | Landing page only | Same scroll-reveal as Card's `revealOnScroll`, for non-card content (step rows, FAQ items). |
| `components/EditorChrome.tsx` | Both field editors (`envelopes/[id]/fields`, `templates/[id]`) | Breadcrumb + close + help/settings + actions slot. **If you change chrome behavior, check both editors** — they don't share a single page component (see §7). |
| `components/PreviewModal.tsx` | Both field editors | Device-width preview using the *real* signing UI, not a mockup — see next row. |
| `components/signing/FieldRenderer.tsx` | `app/sign/[token]/page.tsx` **and** `PreviewModal.tsx` | The actual field rendering (signature pad, checkbox, dropdown, approve/decline buttons, payment button). One implementation, two consumers — **this is the file to change for any field's visual/interactive behavior**, not the sign page directly. Has its own local `Field` type (structurally compatible with `FieldDefinition` from `lib/signing/field-types.ts`, not imported from it — keep them in sync by hand if you add a field type). |
| `components/motion/Popover.tsx`, `Modal.tsx`, `Toast.tsx`, `Toggle.tsx`, `IconButton.tsx` | App-wide | Standard primitives, nothing unusual. |
| `lib/motion/tokens.ts` | Every motion component | `springs.micro/standard/page`, `pressScale`, `hoverLift`, `staggerStep`. Change animation feel here, not per-component. |

---

## 5. Core business logic — where the real rules live

| Concern | File | Notes |
|---|---|---|
| Field types (the enum) | `lib/signing/field-types.ts` | `FieldType` union. Adding a type? Also update: `FieldRenderer.tsx`'s local `Field` type, **both** editors' `FIELD_GROUPS`/`FIELD_LABELS`/`DEFAULT_SIZE`/`FieldIcon`/`FieldPreview` (duplicated, see §7), and `lib/signing/pdf.ts`'s burn logic if it's not text/signature-like. |
| Burning fields into the final PDF | `lib/signing/pdf.ts` | `pdf-lib`-based. Only ever draws NEW content — cannot edit existing PDF text. That's what Quick Edit (next row) exists for. |
| Quick Edit (editing existing PDF text) | `lib/signing/quick-edit.ts` | Different mechanic entirely: pdf.js extracts text runs, groups into lines, classifies font/color; apply = redact rectangle + redraw. Blocked while any envelope from that template is active (`ACTIVE_ENVELOPE_STATUSES`, exported from `lib/signing/envelopes.ts`) — editing a template's PDF live would silently change what an in-progress signer sees, since envelopes don't snapshot the PDF, only the field_map. |
| Envelope lifecycle (send, complete, decline, void, expire) | `lib/signing/envelopes.ts` | `ACTIVE_ENVELOPE_STATUSES` here is the one place that defines "still in flight" — reuse it, don't redefine. |
| Certificate of Completion | `lib/signing/certificate.ts` | Generated once an envelope reaches `completed`. |
| AI field placement | `lib/llm/field-placement.ts` | Used on template upload for autoplace. |
| In-editor AI assistant | `lib/llm/assistant.ts` + `components/assistant/AssistantChatPanel.tsx` | Chat-driven field edits inside the template editor. |
| Subscriptions/billing | `lib/billing/payment-provider.ts` (interface) → `lib/billing/providers/stripe.ts` / `paddle.ts` (Paddle is a registered-but-unimplemented stub) | `cancelSubscription` schedules cancel-at-period-end; the actual downgrade happens later via the `customer.subscription.deleted` webhook → `lib/billing/apply-event.ts`. Two different moments, don't conflate them when debugging. |
| Refunds | `lib/billing/refund.ts` (the actual money-moving call) vs. `SupportMessage.category = "refund"` (a tenant's *request* for one) | A refund request never auto-approves — always a manual admin action via `app/admin/ledger`. |
| Trial → paid conversion | `lib/billing/trial.ts` | Cron-driven (`app/api/cron/trial-processing`). Sends an advance notice N days before charging, then converts or suspends on the actual expiry day. |
| Tier limits / pricing | `lib/config.ts` | Single source of truth for envelope caps, add-ons, trial length — billing logic and UI both read from here, don't hardcode numbers elsewhere. |
| Recipient email OTP | `app/api/sign/[token]/request-otp` + `verify-otp` | Second factor beyond the link itself. Gate lives in `GET /api/sign/[token]`: returns `requires_otp: true` instead of document data until `Recipient.otpVerifiedAt` is set. |

---

## 6. Data model — one line each (`prisma/schema.prisma`)

| Model | What it is |
|---|---|
| `Tenant` | A customer workspace. Billing/tier/trial state lives here. |
| `TenantUser` | A person with dashboard access to a Tenant. Role: owner/admin/sender/viewer. |
| `ApiKey` | External API credential, scoped (`envelopes:read` etc.), tenant-owned. |
| `Template` | An uploaded document + its field_map, reusable across envelopes. |
| `TemplateFolder` | Organizes Templates in the dashboard. |
| `Envelope` | One send — a Template + its own recipients + its own field_map snapshot (fields, not the PDF — see Quick Edit note above). |
| `Recipient` | One person on an Envelope — role (signer/approver/cc), status, OTP state, signature timestamp. |
| `AuditEvent` | Every action on an Envelope (opened, viewed, signed…) — feeds the Certificate. |
| `Certificate` | The generated Certificate of Completion for a finished Envelope. |
| `EnvelopePayment` | A payment field's Stripe Checkout state. |
| `Invoice` | A billing charge or refund record, tenant-facing (shown in Settings). |
| `SupportMessage` | Tenant → Upfinity message; `category` distinguishes refund requests from general ones. |
| `Subscription` | The tenant's active paid plan + external (Stripe/Paddle) customer/subscription id. |
| `UsageMeter` / `UsageCredit` | Monthly usage tracking + purchased top-up credits. |
| `SsoConfig` | Per-tenant SAML SSO configuration. |
| `PlatformAdmin` / `AdminAuditLog` / `PlatformSetting` | Admin-surface-only, not tenant data. |
| `PasswordResetToken` / `AdminPasswordResetToken` | Separate token tables for tenant vs. admin password resets — don't share logic between them, they're deliberately isolated. |
| `RateLimitBucket` / `DeadLetterWebhook` | Infra plumbing — rate limiting, failed outbound webhook retry queue. |

---

## 7. Known gotchas — read before you change these

- **The two field editors are NOT one component.** `app/dashboard/envelopes/[id]/fields/page.tsx` (editing a sent envelope) and `app/dashboard/templates/[id]/page.tsx` (editing a template) each have their **own copies** of `FIELD_GROUPS`, `FIELD_LABELS`, `DEFAULT_SIZE`, `FieldIcon`, and `FieldPreview`. Adding or changing a field type means editing both, by hand, or they'll drift. This is a real duplication, not a design choice — worth consolidating into a shared module if you're touching this area anyway.
- **Envelope creation = immediate send.** There's no "draft, review, then send" step in the current flow — `POST /api/dashboard/envelopes` sends right away. `app/dashboard/envelopes/[id]/fields` exists for correcting fields on an envelope *after* it's already out, not before.
- **Quick Edit only touches `Template.pdfStorageKey`, never a per-envelope copy.** Envelopes don't snapshot the PDF file itself, only the field positions. That's why Quick Edit hard-blocks while any envelope from that template is active — see §5.
- **`FieldRenderer.tsx`'s `Field` type is hand-duplicated from `lib/signing/field-types.ts`'s `FieldDefinition`, not imported.** They're structurally compatible today; adding a field-specific property to one without the other will silently not show up where you'd expect.
- **Approve/Decline fields aren't a separate completion mechanism.** Clicking one calls the exact same `submitAction()` the bottom action bar already used — there's no independent per-field approval state to keep in sync.
- **Mixed line endings across the repo (CRLF vs LF), file by file, not consistently.** Check before scripting bulk edits.
