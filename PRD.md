# Upfinity Sign — Product Requirements Document
**Status:** Living document — source of truth. Update in place, log every material change in the Changelog at the bottom. Do not fork copies; this file is canonical.
**Version:** 2.0
**Last updated:** 2026-08-11

---

## 1. Overview

Upfinity Sign is a standalone, multi-tenant e-signature SaaS platform, built to compete with DocuSign and Google Sign at a lower price point while offering an airtight, PKI-backed audit trail from day one. It launches first as the signing backbone for Dvxel Qbank / Upfinity Talent (candidate offer letters, NDAs, policy acknowledgments), then opens to external tenants — including non-Upfinity companies — with bundled pricing for existing Upfinity/Dvxel clients.

**Positioning:** Cheaper than DocuSign initially, converging toward parity pricing as trust and case studies build. Always Upfinity-branded by default; custom tenant branding sold as a paid add-on.

---

## 2. Tech Stack

- **Frontend/Backend:** Next.js (App Router), TypeScript, deployed on Vercel
- **Database:** Neon (serverless Postgres), Prisma or Drizzle ORM
- **Storage:** Vercel Blob or Cloudflare R2 (templates, signed PDFs, Certificates of Completion)
- **PDF pipeline:** `pdf-lib` (field placement/burn-in) + `node-signpdf` + `node-forge` (PKI signature embedding, PKCS#7/CMS)
- **Signing cert:** DigiCert Document Signing Certificate/Document Signing Manager — purchase timed to external launch, not before (see §7)
- **Key storage:** Cloud KMS (AWS KMS / GCP KMS / Azure Key Vault) — private signing key never touches app memory/filesystem directly
- **AI layer:** Provider-agnostic, config-driven. Primary path is **Vercel AI Gateway** (native to the Vercel stack, zero per-token markup, no separate account/billing to manage) routing to Claude, ChatGPT, Gemini, DeepSeek, and others via one config file (`lib/llm/providers.config.ts`) — add/swap a provider or model there, not in feature code. OpenRouter kept as a manual fallback path for models not yet in the Gateway catalog or local dev. Gateway's native BYOK and Zero Data Retention support cover §9's BYOK roadmap item without custom build.
- **Auth:** Per-tenant API key (hashed) for server-to-server integration (e.g. Dvxel Qbank); token-based access for signer-facing pages (no login required)
- **Webhooks:** HMAC-signed status push to tenant `webhook_url` on every envelope status change

---

## 3. Multi-Tenancy Model

Shared schema, tenant-scoped rows (not schema-per-tenant). Every query scoped by `tenant_id` derived from the authenticated API key server-side — never trust a `tenant_id` from request body.

### Core tables
- `tenants` — id, name, slug, api_key_hash, webhook_url, webhook_secret, branding_enabled, custom_logo_url, custom_domain, tier, created_at
- `users` — tenant admins/staff (for delegated sending, Phase 2)
- `templates` — id, tenant_id, name, pdf_storage_key, field_map (jsonb)
- `envelopes` — id, tenant_id, template_id, status (draft/sent/delivered/opened/signed/completed/declined/voided/expired), external_ref (correlates to Dvxel Qbank record), expires_at
- `recipients` — id, envelope_id, name, email, role (signer/cc/approver), signing_order, status, access_token_hash, ip_address, geo, signed_at, decline_reason
- `audit_events` — append-only. id, envelope_id, recipient_id, event_type, ip_address, user_agent, geo, timestamp
- `certificates` — id, envelope_id, pdf_storage_key, web_view_url, generated_at
- `usage_meters` — tenant_id, metered_item (envelopes_sent, id_verifications, sms_sent, api_calls, storage_gb), period, quantity — feeds billing
- `subscriptions` — tenant_id, tier, addons (jsonb), billing_period, card_on_file (bool)

---

## 4. Integration: Dvxel Qbank ↔ Upfinity Sign

- **Qbank → Sign:** `POST /api/v1/envelopes` with `template_id`, `recipients[]`, `external_ref` (candidate/application ID). Auth via per-tenant API key stored in Qbank's env vars.
- **Sign → Qbank:** HMAC-signed webhook to `tenants.webhook_url` on every status change. Qbank matches on `external_ref`, updates candidate record.
- Fully decoupled — Sign has no knowledge of Qbank's schema.

---

## 5. Certificate of Completion & Audit Trail

- Every completed envelope generates a **Certificate of Completion** as a separate, tamper-evident PDF (not just a DB log): signer names, IPs, geolocation (consented, on by default), verification method, full chain of custody, timestamps.
- Offered as both **PDF and shareable web view**.
- Design: styled as a formal legal document — distinct from the modern/consumer-friendly signing UI, mirroring how DocuSign deliberately separates these visual registers.
- Signed PDF itself gets a **real PKI digital signature** (X.509, via DigiCert cert) embedded via `node-signpdf`, not just a DB-stored SHA-256 hash — decided as a Phase 1 requirement for "defensible from day one" positioning.
- RFC 3161 timestamping applied so signature validity survives cert expiry.
- Legal grounding: ESIGN/UETA's four required elements (intent to sign, consent to electronic format, attribution, record retention with audit trail) are satisfied independent of the PKI layer — PKI adds trust/verification strength (green-checkmark, eIDAS-readiness) on top, it is not what makes the signature legally valid in the US.

---

## 6. Pricing & Packaging

**Structure:** 4 tiers, DocuSign/Google-comparable, positioned slightly cheaper than DocuSign initially with custom support offered, potentially converging toward DocuSign parity long-term as trust builds.

| Tier | Notes |
|---|---|
| Free | Credit card required at signup (filters intent, cuts fraud, frictionless upgrade path). Low envelope cap, Upfinity-branded, no add-ons. |
| Starter | Undercuts DocuSign Personal (~$11/user/mo) |
| Business | Undercuts DocuSign Standard (~$30/user/mo) |
| Enterprise | Custom pricing — PKI, retention, branding, API all included, matches DocuSign Business Pro/Enterprise territory |

**Add-ons (each separately metered):** ID verification, bulk send, extra storage/retention years, API access, custom branding (logo + custom domain).

**Retention policy:** Tiered, modeled on DocuSign's approach — higher tiers get longer retention.

**Reference — DocuSign 2026 list pricing (for comp, not final):** Personal $11/mo (5 envelopes/mo cap), Standard $30/mo, Business Pro $45/mo, Enterprise custom; median real contract value ~$18K/year after negotiation. Google Workspace eSignature is bundled (not standalone) into Business Standard ($14/user/mo, 100-doc cap) and up — not treated as a direct feature competitor, DocuSign is the primary comp.

---

## 7. Certificate Purchase Timing

- Build the full signing pipeline now against a **free, self-signed cert** — identical code path to a CA-issued cert, swap is a config change.
- Purchase the real DigiCert cert (~$283–513/yr, exact tier depends on document volume) at whichever comes first: first external (non-Dvxel) tenant demo/sale, or a specific compliance ask from a prospect.
- No literal "unlimited" flat-fee cert product exists in market — pricing is tiered by document-count cap; revisit at renewal once real volume data exists.

---

## 8. Design System

- Certificate of Completion: formal, legal-document styling.
- Signing UI / dashboard / field editor: modern, consumer-friendly, **Claude-inspired** — clean, generous whitespace, warm neutral background, single confident accent color, calm typography, minimal visual noise.
- Clean slate — no inherited legacy brand constraints.
- Footer on all tenant-facing (non-custom-branded) pages: "Powered by Upfinity Inc." linking to upfinity.ca.
- Premium design applies starting Phase 1, not deferred to a later polish pass.

---

## 8b. Field Types & Signing UX — Built Against Real DocuSign Complaints

Researched actual DocuSign user complaints (G2/Capterra/Trustpilot/community threads, 2026) rather than assuming what "better than DocuSign" means. Two findings drove concrete design decisions:

- **#1 repeated field complaint: text drifts out of alignment after signing, no auto-fit, no vertical centering** — users report spending hours placing fields only to see values render "half a line too high or too low," with DocuSign's own community moderators confirming there's no setting to fix it. Our fix: `lib/signing/pdf.ts`'s burn-in step auto-shrinks font size to fit field width and vertically centers text in the field's height by construction — not an opt-in setting, the only way it renders.
- **Repeated complaint: no WYSIWYG, constant back-and-forth between edit and preview mode to get field sizing right** ("I may ask for 20 signatures on a single envelope... back and forth and back and forth"). Not yet solved by a live template-builder canvas (that's a real scope item — see Phase 3), but the AI auto-placement (§9) sidesteps most of the need for manual placement in the first place.
- **Repeated complaint: fields get attributed to the wrong recipient after a template edit.** Fixed structurally, not procedurally: `full_name`/`email` field types are auto-filled from the `Recipient` row itself at signing time (read-only in the signer UI) rather than manually typed — there's no "wrong person's name ended up in the field" failure mode possible, because the value never comes from free-text entry.
- **Other repeated complaints** (billing/cancellation dark patterns, unresponsive support gated behind higher tiers, pricing surprises at renewal) are business/support-model complaints, not field/UX ones — already addressed by the pricing and support positioning in §6, not a code concern.

**Field type parity** (`lib/signing/field-types.ts` — single source of truth for the template builder, AI placement, signer UI, and PDF burn-in): `signature`, `initial`, `date`, `full_name` (auto-filled), `email` (auto-filled), `company`, `title`, `text`, `number`, `checkbox`, `radio_group`, `dropdown`, `attachment`, `note` (sender-authored read-only annotation), and `custom` (sender-defined regex validation + max length) — matches DocuSign's standard set. AI field placement (§9) recognizes all of these from document layout, not just signature/date/text as in earlier versions.

**Server-side enforcement**: required-field and custom-pattern validation happens in `app/api/sign/[token]/route.ts` against the template's own field definitions before a signature is accepted — client-side validation in the signer page is a UX convenience, not the actual enforcement.

**Not yet built**: live drag-and-drop template canvas (fields are AI-proposed + editable as data today, not visually repositioned in a UI), `attachment` field type has no upload handling wired yet (recognized by the type system, not functional).

## 9. AI Features

Provider-agnostic and config-driven by design — routes to Claude, ChatGPT, Gemini, DeepSeek, and others per feature/tenant via Vercel AI Gateway, no hard lock-in to any single vendor. See §2 for the routing architecture.

**BYOK (Bring Your Own Key):** planned as a Phase 3, Enterprise-tier add-on. Tenants supply their own provider API key; AI feature calls run against the tenant's key/account instead of Upfinity's shared billing. Appeals to compliance-conscious or cost-sensitive enterprise tenants (data/cost liability shifts to their own provider relationship). Vercel AI Gateway supports BYOK natively, so this is a config/UI feature (tenant enters a key, encrypted at rest) rather than new signing-pipeline infrastructure — low build cost, defer until an enterprise tenant asks for it.

**Phase 1 (cheap, high-signal):**
- Auto field placement — LLM scans uploaded PDF layout, proposes signature/date/initial field positions
- Plain-language document summary shown to signers before signing
- Signer Q&A — chat grounded strictly in the document's own text, with a "not legal advice" disclaimer

**Phase 2 (moat-building):**
- Audit anomaly flagging — flags suspicious patterns in the audit trail (IP jumps, geolocation mismatches, abnormal signing speed)
- AI-drafted smart reminders

**Later / enterprise-tier (not prioritized yet):**
- Portfolio-wide contract analytics, clause/playbook comparison, redlining — requires much larger contract corpus and legal-domain tuning; revisit once real paying volume exists.

---

## 10. Branding

- Product name: **Upfinity Sign**. Domain: **upfinitysign.com** (verify availability; consider `.io`/`.app` as defensive redirects).
- Standalone company/product — bundled pricing offered to Dvxel Qbank/Upfinity Talent clients and other Upfinity products, but sellable independently to any company.
- Default: fully Upfinity-branded (product chrome, signing page, "Powered by Upfinity Inc." footer).
- Custom branding (tenant logo/colors on signer page, custom sending domain) — paid add-on, not free at any tier.

---

## 11. Admin Architecture — Super Admin vs Tenant

Two fully separate authentication systems, on purpose — no code path allows one to grant the other's access.

- **Platform (super admin):** `PlatformAdmin` table (separate from any tenant-side table), cookie session auth (`lib/admin-auth.ts`), roles `super_admin` / `support` / `billing_ops`. Every action is written to `AdminAuditLog` — tier changes, suspend/reinstate, logins. Surface: `/admin` (tenant list, tier/status management), `/admin/tenants/[id]` (per-tenant detail). Provisioned manually via `scripts/create-first-admin.js` — no self-signup for platform staff.
- **Tenant-side:** `TenantUser` with roles `owner` / `admin` / `sender` / `viewer`, scoped strictly to that tenant's own data. API access via named, individually revocable `ApiKey` rows (scopes, `lastUsedAt`, `revokedAt`) — replaces the earlier single shared key per tenant. Surface: `/dashboard` (envelope list), `/dashboard/settings` (webhook, API keys, team, plan/retention display).
- **Configurable settings, not just code config:** `PlatformSetting` (platform-wide) and `TenantSetting` (per-tenant override) tables, resolved through `lib/settings.ts` with `config.ts` as the fallback default. This is what makes tier limits and retention windows editable from the admin dashboard instead of requiring a code deploy, while keeping `config.ts` as the version-controlled floor.
- **Kill switch:** `Tenant.suspended` — set from `/admin`, checked in both API auth and envelope creation, blocks a tenant without deleting their data.

**Explicitly deferred, not built:** tenant-user login (dashboard currently reads a `DEV_DASHBOARD_TENANT_ID` placeholder — real auth, e.g. NextAuth/Clerk, is a distinct build item), SSO/SAML for enterprise tenants, rate limiting on the public API, monitoring/alerting on pipeline failures, data export/deletion tooling. See Phase 3 roadmap.

---

## 12. Gap Closure & Performance Review (v1.4)

Closing the enterprise gaps identified in the v1.3 completeness review — honestly, including what's still not fully real.

**Fully closed:**
- **Tenant-user login** — `lib/tenant-auth.ts`, real password auth scoped by workspace slug + email (same email can belong to multiple tenants, so slug disambiguates — same pattern as Slack/Notion). Replaces `DEV_DASHBOARD_TENANT_ID` entirely. Provisioned via `scripts/create-first-tenant-user.js`.
- **API rate limiting** — `lib/rate-limit.ts`, DB-backed fixed-window (`RateLimitBucket`) rather than in-memory, because a serverless deployment has no shared memory across instances — an in-process counter would silently under-count. Config-driven limit (`RATE_LIMIT_PER_MINUTE`), old buckets pruned by the existing hourly cron.
- **Webhook dead-lettering** — failed deliveries (after all retries) now land in `DeadLetterWebhook` instead of just a console log — visible and re-drivable.
- **Data export** — `/api/v1/tenant/export`, owner-only, full JSON dump (envelopes, recipients, audit trail, templates, team — no secrets).
- **Deletion request flow** — `/api/v1/tenant/delete`, owner-only, immediate suspend + 30-day grace period marker (`Tenant.deletionRequestedAt`). Does not hard-delete on request, since signed documents may carry independent retention obligations (§6) — a purge job that respects per-envelope retention is still a TODO, see below.

**Partially closed — real infrastructure, but needs your own credentials to fully activate:**
- **Monitoring** — `lib/monitoring.ts` gives structured logging and a single `captureException()` call site everywhere errors matter, plus `/api/health` for uptime polling. This is genuinely useful on its own (readable, queryable logs), but it does not page anyone until `SENTRY_DSN` is set — there's no way to stand up a real Sentry/Datadog account from inside this build.
- **SSO** — real, working SAML via BoxyHQ's Jackson library (`@boxyhq/saml-jackson`, recently renamed upstream to Ory Polis — same package still works), self-hosted by pointing it at the same Neon Postgres instance, no separate service or account required. Jackson does the actual XML signature validation internally — our own code (`lib/jackson.ts`, `app/api/auth/saml/`) only ever touches its OAuth2-shaped API, never raw SAML XML, which is the responsible way to do this (hand-rolling XML-dsig validation is a well-documented high-risk area — see the removed v1.4 note for why that path was rejected). Method signatures were verified against the actual installed package's `.d.ts` files, not assumed from memory. What's still unverified: a live end-to-end login against a real IdP (Okta/Azure AD/etc.) — this sandbox has no path to one. Test the full authorize → IdP → callback → session round trip against a real IdP before depending on this for a real customer.

**Still open, not started this pass:**
- Retention-aware purge job (the actual cron that acts on `deletionRequestedAt` after the grace period, checking each envelope's retention requirement first)
- Email delivery (signing links/reminders still log, don't send)
- Add-on gating enforcement (id_verification, bulk_send etc. are listed per tier but not yet checked at the point of use)

### Performance review

Issues found and fixed in this pass:
- **Missing indexes** — `Envelope(status, expiresAt)` added for the expiry cron's query (was an unindexed scan), `AdminAuditLog.platformAdminId` added.
- **Unbounded admin tenant list** — `/admin` now paginates (50/page) instead of loading every tenant in one query.
- **Serverless function timeouts** — `maxDuration = 30` added to the sign route (PDF burn-in + PKI signing) and templates route (PDF parsing + LLM call), since Vercel's default timeout can be too short for larger documents.
- **Self-signed cert regeneration** — flagged again here because it's a real perf/consistency issue, not just a security one: without `SELF_SIGNED_PRIVATE_KEY_PEM`/`_CERT_PEM` pinned, every cold start pays RSA keypair generation cost AND signs under a different identity. Pin it (§7, `scripts/generate-self-signed-cert.js`).

Not yet addressed, worth knowing about before scale matters:
- No caching layer (Redis/Vercel KV) for repeated reads like tier limits or tenant lookups — fine at current volume, worth revisiting once `getEffectiveTierLimits()` is called on every request at real traffic.
- `AuditEvent` and `RateLimitBucket` will grow unbounded without an archival strategy — not urgent, but worth a retention job once volume is real.

---

## 13. Payment Gateway Architecture — Provider-Agnostic, Super Admin Configurable

Same pattern as the LLM provider layer (§2): business logic never talks to a payment SDK directly, only `PaymentProvider` (`lib/billing/payment-provider.ts`). Which provider is active is a `PlatformSetting`, switchable from `/admin/billing` with no deploy — `providers.config.ts`'s `DEFAULT_PAYMENT_PROVIDER` is only the fallback if no super admin has chosen one yet.

- **Stripe** — fully implemented, method signatures verified against the actual installed `stripe` package's types (same discipline as Jackson in §11). Checkout session creation, webhook signature verification via Stripe's own `constructEvent` (the security-critical part is Stripe's vetted code, not hand-rolled), and tier-update application are all real. Genuinely inert until `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are set — no account was or can be created from in here.
- **Paddle** — registered in the architecture, deliberately NOT implemented. This isn't a credential blocker like Stripe — it's an architectural one: Paddle Billing's checkout model doesn't have a server-side "create a session, get a redirect URL" primitive the way Stripe does; standard integration is a client-side overlay/inline widget (Paddle.js) or hosted price links, which needs a product decision (embed the overlay in the dashboard vs. redirect to a hosted link) before it can be built correctly. Verified against the real installed `@paddle/paddle-node-sdk` types before concluding this, not assumed.
- **Webhook ingestion is necessarily provider-specific** (different signature headers/schemes) — `/api/webhooks/stripe` is the only provider-specific code; it calls `parseWebhook()` then hands off to `applyBillingEvent()` (`lib/billing/apply-event.ts`), which is 100% provider-agnostic and is where a tenant's tier actually changes in the DB.
- **Super admin sets platform standards**: `/admin/billing` — switch the active provider, and map each self-serve tier (`PLATFORM_TIER_PRICING` in `providers.config.ts`) to that provider's own Price ID. Tenants never see or choose a provider; they just click "Upgrade" (`/dashboard/settings`) and get redirected to checkout.
- **Known real gap, not hidden**: `payment_failed` events are logged but don't trigger any dunning flow (retry emails, auto-downgrade after N failures) — flagged in `apply-event.ts` rather than silently absent.

---

## 14. Phased Roadmap

**Phase 1 (MVP — ships with Dvxel need):**
1. Template builder (upload PDF, place fields, define roles)
2. Single-document, single-recipient send + track (sent → delivered → opened → signed → completed)
3. Consent capture + signing UI + field-level timestamp/IP/geo logging
4. PDF finalize: burn signature in + PKI signature embed (self-signed cert until launch) + lock file
5. Certificate of Completion (PDF + web view)
6. Append-only audit log, tenant dashboard status view
7. Auto-reminder (48hr) + hard expiry on links
8. Void/decline with reason capture
9. AI: auto field placement, signer summary, signer Q&A
10. Premium design system applied throughout

**Phase 2 (post-launch hardening):**
11. Webhook/status push to Dvxel (real-time)
12. Bulk send
13. Multi-document envelopes + per-recipient visibility
14. Tiered retention policy enforced
15. Delegated sending permissions
16. Real DigiCert cert purchased and swapped in
17. AI: audit anomaly flagging, smart reminders

**Phase 3 (product maturity / standalone SaaS growth):**
18. Custom branding add-on (logo, sending domain)
19. Optional paid ID verification tier
20. Multi-signer sequencing/routing order
21. Portfolio-wide AI contract analytics
22. BYOK — tenant-supplied AI provider keys (via Vercel AI Gateway's native BYOK support)
23. Tenant-user login (real session auth, replacing the DEV_DASHBOARD_TENANT_ID placeholder)
24. SSO/SAML for enterprise tenants (IdP metadata, JIT provisioning)
25. Rate limiting on the public API
26. Monitoring/alerting on signing pipeline and webhook delivery failures
27. Tenant data export and deletion tooling (offboarding, GDPR-style requests)

---

## Changelog

- **v2.0 (2026-08-11):** Field type system rebuilt against real DocuSign complaint research (§8b), not assumption. Researched actual user complaints across G2/Capterra/Trustpilot/DocuSign's own community forums before making design decisions. Expanded from 4 field types (signature/initial/date/text) to full DocuSign parity — 13 standard types plus sender-defined custom fields with regex validation. Fixed the #1 repeated complaint (field values drifting out of alignment, no auto-fit) at the rendering level in `lib/signing/pdf.ts` — text now auto-shrinks to fit and vertically centers by construction, not as an optional setting. Fixed the "field attributed to wrong recipient" complaint class structurally — `full_name`/`email` fields auto-fill from the `Recipient` row and are read-only in the signer UI, not manually typed. AI field placement now recognizes the full type set including checkboxes and radio groups, not just signature/date/text. Server-side field validation added to the sign route — required fields and custom patterns are enforced against the template's own definitions, not just client-side.
- **v1.9 (2026-08-11):** Gap-closure batch focused on real security/usability holes, not cosmetic ones. Login brute-force protection — `assertWithinLoginRateLimit()` (tighter limit than the general API, keyed by IP+identifier) wired into tenant login, admin login, and forgot-password, none of which had any throttling before this. Rate limiting extended to the templates endpoint (previously only envelopes had it). Team invite/remove flow — `TenantUser` rows could only be created via CLI script before; now self-serve from Settings, reusing the password-reset token mechanism so "accept invite" and "reset password" are the same underlying flow. Envelope detail page (`/dashboard/envelopes/[id]`) with signed-PDF download, certificate link, and a void action — the dashboard previously only listed envelopes with no drill-down, and `voidEnvelope()` existed with no UI ever calling it. Public Certificate of Completion view (`/certificates/[id]`) — `Certificate.webViewUrl` had pointed here since it was first built, but the page never existed until now. Dashboard list rebuilt with real pagination, status badges, and links. Dunning fix — payment failures now actually email the tenant owner instead of only being logged; flagged that a full retry/downgrade sequence still isn't built. Cleaned up two stale comments (metering.ts and the deletion route) that referenced earlier-version gaps as still open when they'd already been closed in v1.5–1.8.
- **v1.8 (2026-08-11):** Provider-agnostic payment gateway architecture (§13) — same config-driven pattern as the LLM layer. Stripe fully implemented and verified against the real installed SDK's types (checkout sessions, webhook signature verification via Stripe's own `constructEvent`, tier updates). Found and fixed a real bug while building it: `subscription.deleted` events couldn't resolve back to a tenant because metadata was only being set on the checkout session, not the resulting subscription object — fixed with `subscription_data.metadata`. Paddle registered in the architecture but honestly not implemented — verified its real SDK too and confirmed the blocker is a genuine checkout-UX architecture difference (client-side overlay vs. server-redirect), not a missing credential, so it wasn't force-fit into Stripe's shape. Super admin billing panel (`/admin/billing`) — switch active provider, map tiers to that provider's Price IDs, all changes logged to AdminAuditLog. Tenant-facing upgrade buttons wired into Settings, fully provider-agnostic from the tenant's perspective.
- **v1.7 (2026-08-11):** Approval gating (MUST item) — `isRecipientUnlocked()` enforces `signingOrder` server-side on every GET and POST of the sign route, not just at page load; approvers get a distinct `approve` action from `signed`; recipients are notified only when it's actually their turn (`notifyUnlockedRecipients()`), not all at once at send time. Design pass — expanded design tokens (status badges, secondary/danger buttons, shared TopBar/StatusBadge components), full signer-page rebuild with locked/approve/decline states, fixed the Next.js 15 async `params` bug in the process. Self-serve API key creation (`/api/dashboard/api-keys`) — closes the actual gap in the tenant-ID/secret integration story for Upfinity Talent; previously the `ApiKey` model existed but nothing could create one outside `prisma studio`. Forgot/reset password flow, workspace-scoped to handle the same-email-multiple-tenants case correctly. Deduplicated the three copies of role-based email selection into `emailForRole()`.
- **v1.6 (2026-08-11):** Real SAML SSO via BoxyHQ Jackson (self-hosted, no account needed — see §12). Installed the actual package and verified method signatures against its real type definitions before wiring `lib/jackson.ts`, the connection-creation flow (`/api/dashboard/sso`), and the full authorize → IdP → ACS callback → session round trip (`/api/auth/saml/authorize`, `/api/auth/saml/callback`, `/dashboard/sso-callback`). Our own code never parses SAML XML — Jackson does, which is the point. JIT-provisions a TenantUser on first SSO login (as `admin`, not `owner` — ownership stays a deliberate action). Also completed approver/cc email notifications (role-appropriate content, cc excluded from reminders) — flagged clearly that notification ≠ approval gating, since `signingOrder` still isn't enforced anywhere. Still unverified: an actual login against a live IdP, since this environment has no path to one.
- **v1.5 (2026-08-11):** Continued gap closure. Add-on gating enforcement (`lib/billing/addons.ts`, wired into bulk send and branding). Bulk send endpoint (`/api/v1/envelopes/bulk`) with a real fix for a check-then-act race condition in tier-limit checking under concurrent sends. RFC 3161 timestamp request/response client built (`lib/signing/timestamp.ts`) — explicitly flagged as unverified against a real TSA and not yet wired into the signing pipeline, since this sandbox's network allowlist can't reach any TSA to test against. Retention-aware purge job (`lib/billing/retention-purge.ts`, daily cron) that checks per-envelope retention before deleting anything. Real email delivery (`lib/email.ts`, Resend-based, console fallback in dev) wired into envelope creation and reminders. Found and fixed two real bugs while wiring these: the signed PDF's storage key was generated but never persisted anywhere (added `Envelope.signedPdfStorageKey`), and reminder emails had no way to resend a working link since tokens were one-way hashed only (added a separate reversible-encrypted token field, kept strictly apart from the security-critical auth hash). Storage adapters gained a real `delete()` method, used by the purge job.
- **v1.4 (2026-08-11):** Gap-closure and performance pass — see §12 for full detail. Real tenant-user login (replaces DEV_DASHBOARD_TENANT_ID), DB-backed API rate limiting, webhook dead-lettering, tenant data export + deletion request flow, SSO config storage (honestly scoped — not functional SAML), monitoring hooks (structured logging + Sentry-ready error capture, health check endpoint). Performance: added missing indexes, paginated the admin tenant list, added serverless function timeouts to PDF-heavy routes. Explicitly flagged what still needs external credentials (Sentry DSN, a real IdP) or further scoped work (retention-aware purge job, email delivery, add-on gating enforcement) rather than claiming false completeness.
- **v1.3 (2026-08-11):** Completeness review against enterprise-grade requirements. Added §12 Admin Architecture — fully separate super admin (`PlatformAdmin`, RBAC roles, admin audit log) and tenant-side (`TenantUser` roles, per-key revocable API access) systems, DB-backed settings layer (`PlatformSetting`/`TenantSetting`) so tier limits and retention are admin-dashboard configurable instead of code-only, and a tenant suspend/kill-switch. Logged remaining enterprise gaps (SSO, rate limiting, monitoring, data export/deletion, tenant-user login) as Phase 3 roadmap items rather than half-building them. First Claude-inspired design tokens applied (globals.css, root layout).
- **v1.2 (2026-08-10):** Full core build pass — config layer, DB/auth, storage abstraction, complete signing pipeline (cert loading, PDF burn-in + PKI embed, Certificate of Completion), envelope lifecycle, usage metering, HMAC webhooks, envelope/template/sign API routes, minimal signer UI + dashboard, reminder/expiry cron. See README.md "What's stubbed" for the remaining gaps (email delivery, billing provider, DigiCert swap, design polish, dashboard auth).
- **v1.1 (2026-08-10):** Switched AI routing from OpenRouter-only to Vercel AI Gateway as the primary path (native to stack, zero markup, config-driven multi-provider support for Claude/ChatGPT/Gemini/DeepSeek), with OpenRouter kept as fallback. Added BYOK as a Phase 3 roadmap item, enabled via Gateway's native support.
- **v1.0 (2026-08-09):** Initial PRD consolidated from planning conversation — architecture, multi-tenancy, integration pattern, PKI/cert strategy and timing, pricing tiers, design system, AI feature roadmap, branding, and domain decided. Build scaffold started.
