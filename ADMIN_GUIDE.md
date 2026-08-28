# Upfinity Sign — Admin Guide

Everything an operator needs to run Upfinity Sign: environment setup, deployment, platform
administration, and what each subsystem needs configured before it's usable. For architecture
and how the pieces fit together, see `WIKI.md`.

## 1. Prerequisites

- Node.js 20+
- A Neon (or other Postgres) database
- Vercel account (or equivalent Next.js hosting)
- Vercel Blob or Cloudflare R2 for file storage
- An LLM provider key (AI field placement + assistant) — see `lib/llm/providers.config.ts`

## 2. First-time setup

```bash
npm install
npx prisma generate
npx prisma db push
```

Set at minimum:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string — **must include `?sslmode=require`**, the app refuses to boot without it |
| `TENANT_SESSION_SECRET` | HMAC secret for tenant dashboard sessions, and for OAuth's short-lived pending-signup token |
| `ADMIN_SESSION_SECRET` | HMAC secret for platform admin sessions |
| `CREDENTIALS_ENC_KEY` | AES key for recipient access tokens (`lib/token-crypto.ts`) |
| `SELF_SIGNED_PRIVATE_KEY_PEM` / `SELF_SIGNED_CERT_PEM` | Pin once so every signed document shares one signing identity |
| `RESEND_API_KEY` | Primary email provider |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Optional fallback email provider — only activates if Resend fails or isn't set |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in — redirect URI is `{APP_URL}/api/auth/google/callback` |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID` | Microsoft sign-in — redirect URI is `{APP_URL}/api/auth/microsoft/callback`. Tenant ID defaults to `common` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Platform billing (tenant subscriptions + credit packs) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | **Separate** webhook, for tenant payment-field collection — see §9 |
| Storage provider vars | See `lib/storage/index.ts` |

### Creating the first accounts

```bash
node scripts/create-first-admin.js       # platform super_admin — creates every other admin from here on via the UI, see §7
node scripts/create-first-tenant-user.js # first tenant + workspace owner
```

Every other platform admin after the first is invited from `/admin/staff` in the UI — the script
is only needed once, to bootstrap the account that can then invite everyone else.

## 3. Deploying

```bash
vercel deploy --prod
```

`vercel.json` defines cron jobs for reminders and retention-purge — confirm both are enabled in
the Vercel dashboard after first deploy.

## 4. Platform administration (`/admin`)

Sign in at `/admin/login`.

- **Tenants** (`/admin`) — every workspace, paginated; click through to manage tier, suspension,
  usage, and (enterprise tier) verify a requested custom sending email domain.
- **Staff** (`/admin/staff`) — **super_admin only.** Invite/remove platform admins, change roles.
  Invited staff get an email with a set-password link, same pattern as tenant team invites. Two
  safeguards are built in and can't be bypassed from the UI: you can't remove your own access,
  and you can't demote or remove the last remaining super_admin.
- **Audit trail** (`/admin/audit`) — every envelope/recipient event across every tenant (sends,
  opens, signatures, declines, and every failure mode), filterable, failures highlighted. This is
  distinct from the admin action log below — this is what a compliance reviewer looks at.
- **Billing** (`/admin/billing`) — active payment provider, tier Price IDs, and credit-pack Price
  IDs (must be **one-time**, not recurring, Price IDs in Stripe).
- Every admin action (tier changes, suspensions, staff changes, email-domain verification) writes
  to `AdminAuditLog` — separate table from the tenant-facing audit trail above; this one is "who
  on our staff touched what," not "what happened to a signer's envelope."

`/admin` has its own auth (`lib/admin-auth.ts`), never reachable from `/dashboard`, and vice versa.

## 5. Certificate / signing setup

Ships signing self-signed PDFs by default (`SIGNING_CERT_MODE=self-signed`) — cryptographically
sound, but PDF readers show "signature validity unknown" rather than a trusted checkmark. To move
to a CA-trusted signature: provision a DigiCert Document Signing Manager certificate into your
cloud KMS, fill in `loadDigicertCert()` in `lib/signing/cert.ts`, set `SIGNING_CERT_MODE=digicert`.

## 6. What's session-authed vs API-key-authed

- `/api/dashboard/*` — tenant browser session. What the dashboard UI calls.
- `/api/v1/*` — per-tenant API key. External integrations (Upfinity Talent, etc.).
- `/api/admin/*` — platform admin session.
- `/api/public/*` and `/self-serve/*` — no auth at all, deliberately (self-serve signing links).

All four call the same underlying `lib/signing/*` logic — one source of truth for envelope/
template behavior regardless of entry point.

## 7. Enabling optional subsystems

Nothing below is required to run the core product — each activates independently once configured,
same "genuinely inert until set up" pattern as every other provider integration here.

**Google/Microsoft sign-in** — register an OAuth app with each provider, set the client ID/secret
env vars above. Until configured, the buttons redirect to a clear "not configured yet" message
rather than failing silently.

**AI features (field placement, assistant, document generation)** — set an LLM provider key.
Configurable per-feature in `lib/llm/providers.config.ts`.

**Payment collection (payment fields)** — this is Stripe **Connect**, deliberately separate from
platform billing, so a tenant's collected payments go to *their own* connected account, never
through Upfinity's. Two things must both be true before a tenant can add payment fields:
1. `STRIPE_SECRET_KEY` set at the platform level (same key used for billing works).
2. The tenant connects their own account from Settings → Payment collection → "Connect Stripe" —
   this is a per-tenant Express account via Stripe's hosted onboarding, tracked by
   `Tenant.stripeConnectedAccountId` / `stripeConnectOnboarded`.

Configure a **second, separate** webhook endpoint in the Stripe Dashboard pointing at
`/api/webhooks/stripe-connect` with its own signing secret (`STRIPE_CONNECT_WEBHOOK_SECRET`) —
do not point this at the same webhook config as platform billing (`/api/webhooks/stripe`). Mixing
the two would make it possible to cross-wire a platform billing event with tenant payment money;
they're kept on separate endpoints by construction, not just by convention.

**Bulk send, self-serve signing links, custom email domains** — tier/addon-gated, no extra
platform config beyond what's already above.

### Open decision: how customer card data is stored

**Current model (as-built, in production):** Upfinity never receives, stores, or touches a raw
card number at any point. Card entry happens entirely on the payment processor's own hosted
Checkout page; what comes back to us is only an opaque customer/token reference
(`Tenant.trialExternalCustomerId`, `Subscription.externalCustomerId`) used to charge, retry, or
refund via that processor's API. This keeps the platform in the lightest PCI DSS compliance tier
(SAQ A) — there is no cardholder data environment to secure because cardholder data never enters
our systems.

**Under evaluation, not implemented:** whether to instead store card data (even encrypted/
tokenized/hashed across tables) directly, to reduce dependence on any single payment processor.
Flagging this explicitly because it is a materially different risk posture, not a code detail:

- Receiving raw card data — even briefly, even to immediately encrypt it — moves the platform into
  SAQ D, PCI DSS's highest tier: a formal annual audit by a Qualified Security Assessor, quarterly
  external penetration testing, and network segmentation requirements a serverless environment
  isn't inherently built for.
- A single application-layer key that decrypts stored card data (as opposed to HSM-backed key
  custody, where the key itself is never extractable even by the engineers who provisioned it)
  concentrates risk rather than distributing it — one compromise exposes every stored card at
  once, versus the current model's zero cards to expose.
- This decision is being evaluated directly by the platform's own PCI DSS-experienced stakeholder
  and is intentionally left as-is (current tokenized-reference model) until that evaluation
  concludes. Nothing in the codebase currently implements card-data storage of any kind — this
  note exists so that stays a deliberate choice, not something a future contributor reverses
  without knowing it was already considered.

## 8. Common operational tasks

| Task | Where |
|---|---|
| Suspend a tenant | `/admin/tenants/[id]` → Suspend |
| Change a tenant's tier | `/admin/tenants/[id]` → Tier dropdown |
| Verify a tenant's custom sending email domain | `/admin/tenants/[id]` → confirm DNS/domain ownership out of band, then "Mark verified" |
| Invite/remove platform admin staff | `/admin/staff` (super_admin only) |
| Rotate the signing cert | See §5 |
| Check webhook delivery failures (tenant integrations) | `lib/webhooks/dispatch.ts` logs via `lib/monitoring.ts` |
| Purge expired data | Automatic via the `retention-purge` cron |
| Add/remove an LLM provider | `lib/llm/providers.config.ts` — no feature code changes needed |
| Add/change a credit pack | `lib/billing/providers.config.ts`'s `CREDIT_PACKS`, then set its Price ID in `/admin/billing` |

## 9. Troubleshooting

- **Prisma client errors on build** — run `npx prisma generate` after any schema change. If it
  fails with a network/checksum error, your build environment can't reach `binaries.prisma.sh` —
  allow that domain, or generate in an environment that can.
- **Webhooks not firing (tenant integrations)** — check `webhookUrl` is set in tenant Settings, check
  delivery logs.
- **AI field placement returns nothing** — the template still gets created with an empty field
  map; the sender places fields manually. Check the configured LLM provider's key/quota.
- **AI assistant / document generation errors** — same LLM provider check; also confirm the
  tenant hasn't exhausted their `ai_messages` monthly allowance + credits (Settings → Usage &
  credits).
- **Payment field shows "not available"** — the tenant hasn't finished Stripe Connect onboarding
  (`stripeConnectOnboarded` is false) — have them return to Settings and finish it, or check
  `account.updated` events are reaching `/api/webhooks/stripe-connect`.
- **A platform admin invite email never arrives** — the invite row and token still exist even if
  email delivery failed (see the dev-fallback note in §7's email config) — check server logs for
  the delivery error, or have a super_admin re-check `/admin/staff` for pending status.
