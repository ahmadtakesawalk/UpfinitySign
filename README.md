# Upfinity Sign

Multi-tenant e-signature SaaS. Full spec, decisions, and roadmap live in **[PRD.md](./PRD.md)** —
treat it as the source of truth and update its Changelog on every material decision.

## What's real and working

**Core product:**
- `prisma/schema.prisma` — complete data model incl. RBAC, admin audit log, per-tenant API keys, DB-backed settings
- `lib/config.ts` — every tunable default in one place; `lib/settings.ts` layers admin-dashboard overrides on top (see below)
- `lib/db.ts` / `lib/auth.ts` — Prisma client singleton, scoped/revocable tenant API-key authentication
- `lib/storage/` — Vercel Blob / R2 abstraction, switchable via config
- `lib/llm/` — provider-agnostic AI client via Vercel AI Gateway (Claude/ChatGPT/Gemini/DeepSeek, config-driven), auto field-placement wired end to end
- `lib/signing/` — full pipeline: cert loading (self-signed today, DigiCert-ready), PDF field burn-in, PKI signature embedding, Certificate of Completion generation, envelope lifecycle, append-only audit trail
- `lib/billing/metering.ts` — usage tracking + tier limit enforcement, now resolved through admin-configurable effective limits (see settings below), respects the tenant suspend kill-switch
- `lib/webhooks/dispatch.ts` — HMAC-signed status push with retry/backoff
- `app/api/v1/` (envelopes, templates) and `app/api/sign/[token]/` — fully wired API surface
- `app/api/cron/reminders/` + `vercel.json` — scheduled expiry + reminder logging

**Admin / RBAC (see PRD §11):**
- `lib/admin-auth.ts` — super admin session auth (separate from tenant auth entirely — see PRD §11 for why)
- `lib/tenant-auth.ts` — real tenant-user login (workspace slug + email + password), replaces the earlier DEV_DASHBOARD_TENANT_ID placeholder entirely
- `lib/admin-audit.ts` — logs every platform-staff action
- `lib/settings.ts` — `PlatformSetting`/`TenantSetting` DB overrides on top of `config.ts` defaults — makes tier limits and retention admin-dashboard editable without a deploy
- `middleware.ts` — route-level separation of `/admin/*` and `/dashboard/*` from everything else, and from each other
- `app/admin/` — super admin dashboard (paginated tenant list, tier/suspend management)
- `app/dashboard/settings/` — tenant admin settings (webhook, API keys, team, SSO config storage, data export/deletion)
- `scripts/create-first-admin.js` / `scripts/create-first-tenant-user.js` — provision the first accounts on each side (no self-signup, by design)

**Reliability / ops (added in the v1.4 gap-closure pass — see PRD §12):**
- `lib/rate-limit.ts` — DB-backed rate limiting (works correctly across serverless instances, unlike an in-memory counter)
- `lib/monitoring.ts` + `app/api/health/` — structured logging, Sentry-ready error capture (no-op until `SENTRY_DSN` is set), uptime health check
- `DeadLetterWebhook` — failed webhook deliveries are now captured, not just logged
- `app/api/v1/tenant/export/` + `app/api/v1/tenant/delete/` — data export and deletion request (grace period, doesn't hard-delete immediately)
- `SsoConfig` — stores IdP config from Settings; does NOT implement real SAML/OIDC login yet (see PRD §12 for exactly why, and what building it for real would need)

**UI:**
- `app/globals.css` — full design token system: neutral paper/ink base with one deliberate bright
  signature accent (electric indigo `#4b2bff`), replacing the earlier cream/terracotta palette
- `lib/motion/tokens.ts` + `components/motion/` — spring-based motion system (Button, Card, Toast,
  Skeleton), `app/template.tsx` for route-level entrance transitions — applied product-wide via
  the root layout and shared primitives
- `app/dashboard/templates/` — template list, upload + AI field-placement, and a full drag/resize
  field-placement builder rendered over the real PDF (pdfjs-dist) — was API-only before this pass
- `app/dashboard/envelopes/new/` — envelope creation from the UI: pick a template, fill in
  recipients per detected role, send — was API-only before this pass
- `app/api/dashboard/templates/` + `app/api/dashboard/envelopes/` — session-authed routes backing
  the above, calling the same `lib/signing/*` logic the `/api/v1/*` API uses
- `app/page.tsx` — public marketing landing page (was missing entirely before this pass)
- `app/dashboard/page.tsx`, `app/dashboard/settings/page.tsx` — real empty-state CTAs and
  consistent nav (settings previously had no top nav at all)

See **[ADMIN_GUIDE.md](./ADMIN_GUIDE.md)** for operating this, **[USER_FAQ.md](./USER_FAQ.md)**
for the end-user-facing walkthrough, **[WIKI.md](./WIKI.md)** for the technical architecture
reference (domain model, signing pipeline, AI subsystem, billing, and known gaps), and
**[INTEGRATIONS.md](./INTEGRATIONS.md)** for the external API/webhook contract — including a
concrete walkthrough of how Upfinity Talent (or any platform) integrates seamlessly from within
its own UI.

**Still API-only / not yet in the UI:** admin billing provider switching UI exists but isn't
polished; SSO config UI exists in Settings but no live IdP has been tested against it (see PRD
§12). Everything else in the capability matrix below IS reachable from the UI as of this pass.

## What's stubbed / explicitly deferred (see PRD §12 for the full list)

- **DigiCert cert loading** — blocked on the actual purchase, per PRD §7 timing
- **RFC 3161 timestamp embedding** — `lib/signing/timestamp.ts` has a request/response client, but it's UNVERIFIED against a real TSA (this sandbox can't reach one) and not wired into the signing pipeline yet — see that file's header before trusting it
- **Paddle billing** — architecturally deferred (not a credential blocker), see PRD §13
- **Dunning flow** — failed payments are logged, no retry emails or auto-downgrade after N failures
- **Sentry/Datadog account** — `captureException()` is wired and ready, does nothing until you set `SENTRY_DSN` yourself
- **Approval gating** — ~~signingOrder isn't enforced~~ **outdated as of this pass** — `isRecipientUnlocked()` in `lib/signing/envelopes.ts` does gate strictly on `signingOrder`; each recipient is only notified/unlocked once everyone before them has acted. Leaving this note in case something regresses it.
- **Full design pass** — see the UI section below; this pass covers motion foundation + the core send flow, not every page yet

**SSO (`@boxyhq/saml-jackson`) needs one extra setup step the others don't:** Jackson manages its own tables in your Neon DB, separate from the Prisma schema — it creates/migrates them itself on first use, no `prisma db push` needed for Jackson's tables specifically. First real SSO connection creation call will trigger that. And as with everything else in this build: the code is real and its types were verified against the actual installed package, but no login has actually been run against a live IdP — see PRD §12 before promising this to a customer.

## Setup

\`\`\`bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL (Neon), ADMIN_SESSION_SECRET, TENANT_SESSION_SECRET at minimum
npx prisma db push           # sync schema to Neon
node scripts/create-first-admin.js you@upfinity.ca 'a-strong-password'
node scripts/create-first-tenant-user.js dvxel "Dvxel Qbank" admin@dvxel.com 'a-strong-password'
npm run dev
\`\`\`

Visit `/admin/login` for the platform admin dashboard, `/dashboard/login` for the tenant dashboard
(workspace = the slug you used above, e.g. `dvxel`). For the API integration flow: create an
`ApiKey` row for that tenant (via `prisma studio`, using `generateApiKey()` from `lib/auth.ts` for
the key), POST a PDF to `/api/v1/templates`, then POST to `/api/v1/envelopes`.

## Deploy

Vercel, connected to this repo, with the same env vars set in the project's Environment
Variables settings. Neon connection string should use the pooled endpoint for serverless
function compatibility. Set `CRON_SECRET` for the reminders cron and `ADMIN_SESSION_SECRET`
for admin login — both required, the app will throw clear errors if missing rather than
silently running insecurely.
