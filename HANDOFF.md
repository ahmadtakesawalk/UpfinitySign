# Upfinity Sign — Hand-off

Written for whoever picks this up next. Pairs with `CODEBASE_WIKI.md`
(architecture map, routes, shared components) — this doc is status and
"what to do first," not a reference.

---

## Do this first, before anything else

1. **Run the Prisma migration.** `npx prisma generate && npx prisma migrate dev`
   (or your normal deploy migration step). This was never run against a
   real database this session — the sandbox this work was done in has no
   network access to Prisma's binary download, so two schema changes below
   were written by hand, matched to existing model conventions, but never
   verified against a generated client or a live migration. That's the one
   thing that genuinely needs your own environment to confirm.
2. **Set OAuth env vars if you want Google/Microsoft sign-in live**:
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`,
   `MICROSOFT_CLIENT_SECRET`. The code is real and complete either way —
   without these it returns a clean 503 instead of pretending to work.

---

## What shipped this session

**Editors & signing flow**
- Recipient/role selector at the top of both field editors' palettes
- Shared `EditorChrome` (breadcrumb, close, help/settings) replacing the
  generic dashboard topbar on both editors
- Real interactive Preview (device-width toggle, live field behavior —
  reuses the actual `FieldRenderer` the signing page renders, not a mockup)
- Undo/redo in the envelope field editor (Ctrl+Z / Ctrl+Shift+Z + toolbar)
- Inline "upload a document" flow on Send an Envelope — skips the old
  forced two-step (create template, then separately send)
- Approve / Decline / Stamp field types — placeable, styled, and (for
  Approve/Decline) wired to the exact same completion action the bottom
  action bar already used
- Quick Edit — in-browser line-level text editing of a template's PDF.
  Real font-family/weight/style detection (via pdf.js's own classification)
  and real color (sampled from the rendered canvas), not a flat black-
  Helvetica guess. Blocked while any envelope from that template is active,
  since the sign page reads the template's PDF directly, not a snapshot.

**Security & trust**
- Email OTP as a second factor on signing links (6-digit code, 10-minute
  expiry, attempt-capped) — layered on top of the existing possession-based
  link, doesn't replace it
- "I don't recognize this — flag as suspicious" quick-decline option
- Certificate of Completion is now actually surfaced to the signer after
  signing (previously the page existed but nothing ever linked to it)

**Billing**
- Self-serve "Cancel plan" (schedules cancel-at-period-end, doesn't yank
  access immediately)
- Self-serve refund *request* per invoice — creates a distinctly-flagged,
  trackable ticket; does not auto-approve money back, that's still a manual
  admin action
- Advance-notice email before a trial auto-converts to paid (previously
  the only email was sent *after* the charge)

**API / integrations**
- `GET /api/v1/envelopes/list` — the missing piece for an integrating
  platform to build its own sent/pending/completed view; everything else
  (create, bulk create, webhooks, per-envelope status with signed-PDF and
  certificate links) already existed

**Design / UI polish**
- Landing page: scoped hero gradient, scroll-triggered reveals, section
  contrast rhythm, animated nav underline (matches how DocuSign actually
  uses gradient — sparingly, not everywhere)
- FAQ: category-switch and search-result transitions
- Full button-consistency pass: every real CTA app-wide now uses the
  shared animated `Button` component instead of a mix of raw `<button>`
  elements — tab switchers, inline text-links, and high-repeat nav
  (pagination, folder lists) were deliberately left plain, matching the
  "little-to-no animation on things clicked constantly" principle
- **Real bug found and fixed during that pass, not cosmetic**: `Button`
  had no default `type`, so any instance sitting inside a `<form>` defaulted
  to `type="submit"` — this is what was breaking Google/Microsoft sign-in
  (clicking either submitted the email/password form instead of navigating
  to the provider). Fixed at the component level, which retroactively
  protects every other button with the same latent issue, not just those two.

---

## Genuinely still open

| Item | Status |
|---|---|
| LinkedIn sign-in | Not built — needs a Client ID/Secret from a LinkedIn OAuth app |
| Personal profile (name/photo) + notification preferences | Needs a schema change (`TenantUser` has no `name` field at all today) — flagged, never got a go/no-go |
| Maintenance mode | Plan exists, nothing built — explicitly deferred to "last," never circled back |
| Approve/Decline as a genuinely separate per-recipient completion state | Current implementation reuses the existing whole-envelope approve/decline action — a fine, honest scope choice, but if you want true partial multi-step approval workflows, that's more work |

## Deliberately not touched, with reasoning

- FAQ/Integrations/legal pages didn't get the landing page's motion
  treatment — utility search, API docs, and legal text respectively; motion
  there reads as gimmicky, not polish
- Admin-only internal pages (`app/admin/**`) weren't included in the
  button-consistency audit — separate surface, lower priority than
  customer-facing UI

## Known, permanent limitations (not bugs)

- **Quick Edit font matching**: matches family/weight/style (serif vs
  sans vs monospace, bold, italic) via pdf.js's own font classification,
  but cannot reproduce a genuinely custom/branded embedded font exactly —
  that needs the actual font file re-embedded, a separate project.
- **Quick Edit redaction**: an opaque rectangle in the sampled background
  color — wrong on a line whose background varies pixel-to-pixel (an
  image, a gradient) behind it. Correct for the overwhelming majority of
  documents.

## Codebase quirks worth knowing before you touch things

See `CODEBASE_WIKI.md` §7 for the full list — the short version: the two
field editors (`envelopes/[id]/fields` vs `templates/[id]`) duplicate their
field-type constants by hand rather than sharing a module, envelope
creation sends immediately (no draft step), and line endings are mixed
CRLF/LF file-by-file across the repo.
