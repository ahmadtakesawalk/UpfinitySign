# Upfinity Sign — Integration Guide

How another platform (Upfinity Talent, or anything else) sends documents through Upfinity Sign
and hears back when they're signed — without the person on the other end ever needing to know
Upfinity Sign exists as a separate product. Every endpoint and payload shape below is taken
directly from the current code, not aspirational — see the file path in each section if you want
to verify against the source yourself.

## 1. The shape of the integration, in one paragraph

Your platform holds an **API key** (per-tenant, created in Sign's dashboard). It calls
`POST /api/v1/envelopes` with a template, a recipient, and your own internal ID for whatever
record this belongs to (a candidate, a deal, an order — `external_ref`). Sign sends the signing
email directly to that person — they never see or need an Upfinity Sign account. The moment
something changes (sent, signed, declined, voided, expired), Sign pushes an HMAC-signed webhook to
a URL you configure, carrying that same `external_ref` back, so your platform can update its own
record without ever polling.

## 2. Setup — one-time, per workspace

1. In Sign, go to **Settings → API Keys → Create key**. Copy the raw key immediately — it's shown
   exactly once. Scope it to `envelopes:write` (and `envelopes:read` only if your integration will
   also poll status directly rather than relying on the webhook).
2. In Sign, go to **Settings → Webhook**, set the URL your platform will receive events at, and
   copy the generated webhook secret — you'll use it to verify incoming signatures.
3. **Create your templates once, as a human, in Sign's own UI or via the AI assistant** — upload
   the offer letter / NDA / whatever document, place or confirm its fields, save. Note the
   template's ID (visible in its URL: `/dashboard/templates/<template_id>`). Your integration
   should reference this stored ID on every send — it should not be creating or editing templates
   on every request. Building documents is a one-time setup task, not a per-record API call.

## 3. Sending a document

`POST /api/v1/envelopes` — auth via `Authorization: Bearer <api_key>`
(`app/api/v1/envelopes/route.ts`)

```json
{
  "template_id": "clx...",
  "external_ref": "candidate-4821",
  "recipients": [
    { "name": "Jane Doe", "email": "jane@example.com", "role": "signer", "signing_order": 1 }
  ],
  "expires_in_hours": 168
}
```

Response (`201`):
```json
{ "envelope_id": "clx...", "status": "sent" }
```

`role` is `"signer" | "cc" | "approver"`. For a multi-recipient template (an offer letter that
also needs a manager's approval, say), include one entry per role slot the template defines, each
with the matching `signing_order` — see the template's role convention
(`signer_1`, `approver_1`, etc.) in its field map.

**Sending to a large batch at once?** `POST /api/v1/envelopes/bulk` takes the same shape with a
`recipients_batches` array — one envelope per batch, same template, in one call
(`app/api/v1/envelopes/bulk/route.ts`).

## 4. Hearing back — the webhook

Configured once in Settings, fires automatically from here on
(`lib/webhooks/dispatch.ts` — `dispatchWebhook`, called from `lib/signing/envelopes.ts`).

**The exact event types that fire** (nothing more granular currently exists — there's no
per-recipient "opened" or "signed" webhook, only these envelope-level transitions):

| `event` | Fires when |
|---|---|
| `envelope.sent` | Immediately after creation |
| `envelope.completed` | Every recipient has finished (all signed/approved) |
| `envelope.declined` | Any recipient declines |
| `envelope.voided` | Sender voids it manually |
| `envelope.expired` | Passed its expiration without completing |

**Payload** (POST to your configured URL, `content-type: application/json`):
```json
{
  "event": "envelope.completed",
  "envelope_id": "clx...",
  "external_ref": "candidate-4821",
  "status": "completed",
  "timestamp": "2026-08-24T10:15:00.000Z"
}
```
(`envelope.declined`/`envelope.voided` additionally carry a `"reason"` field.)

**Verifying it's genuinely from Sign** — the request carries an `x-upfinity-signature` header, an
HMAC-SHA256 of the raw JSON body using your webhook secret:
```ts
import { createHmac } from "crypto";
const expected = createHmac("sha256", YOUR_WEBHOOK_SECRET).update(rawBody).digest("hex");
const isValid = expected === req.headers["x-upfinity-signature"];
```
Reject anything that doesn't match before trusting the payload.

**Delivery reliability:** exponential backoff, up to `config.webhooks.maxRetries` attempts (5 by
default). If every attempt fails, the event is written to a dead-letter table rather than silently
dropped — recoverable, but currently requires direct database access to inspect; there's no admin
UI for replaying dead-lettered webhooks yet.

**The webhook tells you status changed — it doesn't carry the signed document itself.** To get the
actual signed PDF or Certificate of Completion, call the status endpoint below once you've heard
`envelope.completed`.

## 5. Checking status directly (polling fallback / fetching the signed document)

`GET /api/v1/envelopes/:id` (`app/api/v1/envelopes/[id]/route.ts`)

```json
{
  "envelope_id": "clx...",
  "status": "completed",
  "external_ref": "candidate-4821",
  "expires_at": "2026-08-31T10:15:00.000Z",
  "completed_at": "2026-08-24T10:15:00.000Z",
  "recipients": [
    { "id": "clx...", "name": "Jane Doe", "email": "jane@example.com", "role": "signer", "status": "signed", "signedAt": "2026-08-24T10:15:00.000Z" }
  ],
  "signed_pdf_url": "https://.../signed/....pdf",
  "certificate_url": "https://.../certificates/clx..."
}
```

Prefer the webhook for normal operation — this endpoint is for manual checks, debugging, or
fetching the document links once you already know it's complete.

## 6. Concretely: how this looks from inside Upfinity Talent

This is the part that makes it feel like one product instead of two — nothing here requires the
candidate, or even the recruiter day-to-day, to know Upfinity Sign exists separately.

**One-time setup (a Dvxel admin, once):**
- Build the offer-letter template in Sign (upload, confirm fields — candidate name/email
  auto-fill, signature, date).
- Store that template's ID in Talent's own tenant configuration (e.g. a `SIGN_OFFER_TEMPLATE_ID`
  setting), alongside the API key and webhook secret from step 2 above.

**The actual flow, every time (fully automated after this):**
1. A recruiter moves a candidate to "Offer" in Talent's own pipeline UI and clicks **Send Offer
   Letter** — a button that lives entirely inside Talent, not a link out to Sign.
2. Talent's backend calls `POST /api/v1/envelopes` with the stored template ID, the candidate's
   name/email pulled from Talent's own database, and `external_ref` set to Talent's candidate ID.
3. The candidate gets a signing email directly — sent from Sign, but nothing about it needs to
   surface "Upfinity Sign" as a distinct brand to them if you don't want it to (enterprise-tier
   custom sending domains exist for exactly this — see the FAQ).
4. Talent's own webhook receiver (a route Talent's team builds, verifying the HMAC signature as
   shown above) listens for `envelope.completed` / `envelope.declined`, looks up the candidate by
   `external_ref`, and flips their pipeline status automatically — "Offer sent" → "Signed" — with
   zero manual follow-up from the recruiter.
5. Optionally, Talent calls `GET /api/v1/envelopes/:id` once on receiving `envelope.completed` to
   grab `signed_pdf_url` and show a "View signed offer" link directly on the candidate's profile
   inside Talent — again, no separate login to Sign required.

**What this requires building on Talent's side** (being direct about the division of labor — Sign
provides the API/webhook contract above; these three pieces are Talent's own work, not something
Sign does for it):
- The "Send Offer Letter" button/action in Talent's UI
- A webhook receiver endpoint in Talent's backend, with signature verification
- The `external_ref` ↔ candidate-ID mapping (trivial — just pass Talent's own ID as `external_ref`
  on every call, Sign never needs to understand Talent's schema)

## 7. A few things worth knowing before building against this

- Every envelope/template created via the API shows up identically in the tenant's own Sign
  dashboard — same audit trail, same usage counts against plan limits. There's no
  API-only shadow state; one source of truth regardless of entry point
  (`lib/signing/envelopes.ts`'s `createEnvelope` is the single function both the dashboard UI and
  this API call into).
- Rate limiting and plan usage limits apply to API-created envelopes exactly like dashboard-created
  ones — a burst of automated sends can hit the same monthly cap a human sending manually would.
- `POST /api/v1/templates` also exists (upload + AI field placement via API) if you genuinely need
  template creation to be programmatic rather than a one-time human setup step — but for a typical
  integration like the offer-letter flow above, creating templates once by hand and referencing
  the ID is the simpler, recommended pattern.
