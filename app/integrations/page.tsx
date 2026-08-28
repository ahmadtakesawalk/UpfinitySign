// DEPLOY TO: app/integrations/page.tsx
//
// Rendered version of INTEGRATIONS.md — customers shouldn't need to find
// a raw .md file in the repo to see this. Same content, same accuracy
// standard (verified against the real route handlers, not written from
// memory), just an actual page with a real URL.

export default function IntegrationsPage() {
  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "48px 24px 80px" }}>
      <a href="/" className="topbar-brand" style={{ display: "inline-block", marginBottom: 24 }}>Upfinity Sign</a>
      <h1>Integrations</h1>
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
        How another platform — Upfinity Talent, or anything else — sends documents through
        Upfinity Sign and hears back the moment they're signed, without the recipient ever needing
        to know Upfinity Sign exists as a separate product.
      </p>

      <h2>The shape of it, in one paragraph</h2>
      <p>
        Your platform holds an <strong>API key</strong> (per-workspace, created in{" "}
        <a href="/dashboard/settings">Settings → API Keys</a>). It calls one endpoint with a
        template, a recipient, and your own internal ID for whatever record this belongs to — a
        candidate, a deal, an order. Sign emails the signing link directly to that person. The
        moment something changes — sent, signed, declined, voided, expired — Sign pushes a
        signed webhook back to a URL you configure, carrying that same ID, so your platform can
        update its own record automatically. No polling, either direction.
      </p>

      <h2>Setup — one time, per workspace</h2>
      <ol>
        <li>Settings → API Keys → Create key. Copy the raw key immediately — it's shown once.</li>
        <li>Settings → Webhook — set the URL your platform receives events at, and copy the
        generated webhook secret.</li>
        <li>Build your templates once, as a human, in the template builder or with the AI
        assistant — the document itself should be a one-time setup task, not something your
        integration builds on every request. Note the resulting template's ID.</li>
      </ol>

      <h2>Sending a document</h2>
      <p><code>POST /api/v1/envelopes</code> — authenticated with <code>Authorization: Bearer &lt;api_key&gt;</code></p>
      <pre style={{ background: "var(--bg-subtle)", padding: 16, borderRadius: 8, overflowX: "auto", fontSize: 13 }}>
{`{
  "template_id": "clx...",
  "external_ref": "candidate-4821",
  "recipients": [
    { "name": "Jane Doe", "email": "jane@example.com", "role": "signer", "signing_order": 1 }
  ]
}`}
      </pre>
      <p>Sending to many recipients at once from the same template? <code>POST /api/v1/envelopes/bulk</code> takes the same shape with a batch array.</p>

      <h2>Hearing back — the webhook</h2>
      <table>
        <thead><tr><th>Event</th><th>Fires when</th></tr></thead>
        <tbody>
          <tr><td>envelope.sent</td><td>Immediately after creation</td></tr>
          <tr><td>envelope.completed</td><td>Every recipient has finished</td></tr>
          <tr><td>envelope.declined</td><td>Any recipient declines</td></tr>
          <tr><td>envelope.voided</td><td>Sender voids it manually</td></tr>
          <tr><td>envelope.expired</td><td>Passed its expiration without completing</td></tr>
        </tbody>
      </table>
      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
        These are envelope-level events only — there's no separate "opened" or "signed" webhook
        per recipient.
      </p>
      <p>Every request carries an <code>x-upfinity-signature</code> header — an HMAC-SHA256 of the raw body using your webhook secret. Verify it before trusting the payload.</p>

      <h2>Checking status directly</h2>
      <p>
        <code>GET /api/v1/envelopes/:id</code> — for polling as a fallback, or for fetching the
        signed PDF and Certificate of Completion links once you've heard <code>envelope.completed</code>.
      </p>

      <h2>Listing envelopes — building your own sent/pending/completed view</h2>
      <p>
        <code>GET /api/v1/envelopes/list</code> — returns your envelopes newest-first, in the same
        shape as the single-envelope lookup above (status, signed PDF link, certificate link),
        paginated. This is what backs an internal dashboard inside your own platform — you don't
        need to poll individual envelopes one at a time to know what's outstanding.
      </p>
      <p><code>?status=</code> filters to one of <code>pending</code>, <code>completed</code>,
      <code>declined</code>, <code>voided</code>, or <code>expired</code> — omit it for everything.
      <code>?external_ref=</code> narrows to whatever record on your side an envelope was created
      against. <code>?limit=</code> (default 25, max 100) and the returned <code>next_cursor</code>
      handle pagination — pass it back as <code>?cursor=</code> to get the next page, <code>null</code>
      means you're at the end.</p>
      <pre style={{ background: "var(--bg-subtle)", padding: 16, borderRadius: 8, overflowX: "auto", fontSize: 13 }}>
{`GET /api/v1/envelopes/list?status=pending&limit=25

{
  "envelopes": [
    {
      "envelope_id": "clx...",
      "status": "sent",
      "external_ref": "candidate-4821",
      "created_at": "2026-08-20T14:03:00Z",
      "completed_at": null,
      "recipients": [...],
      "signed_pdf_url": null,
      "certificate_url": null
    }
  ],
  "next_cursor": "clx...9f2"
}`}
      </pre>

      <h2>What a real integration looks like — Upfinity Talent, concretely</h2>
      <p>
        A recruiter moves a candidate to "Offer" inside Talent's own pipeline and clicks{" "}
        <strong>Send Offer Letter</strong> — a button that lives entirely inside Talent, never a
        link out to Sign. Talent's backend calls the envelope endpoint with the stored template
        ID, the candidate's details, and the candidate's own ID as <code>external_ref</code>. The
        candidate gets a signing email directly. Talent's own webhook receiver hears{" "}
        <code>envelope.completed</code>, looks up the candidate by <code>external_ref</code>, and
        flips their status automatically — zero manual follow-up.
      </p>
      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
        Building the "Send Offer Letter" button and the webhook receiver is the integrating
        platform's own work — Sign provides the contract above, not a drop-in widget.
      </p>

      <h2>Worth knowing</h2>
      <ul>
        <li>An envelope created via the API shows up identically in your own dashboard — same
        audit trail, same usage counts against your plan.</li>
        <li>Rate limits and plan usage apply to API-created envelopes exactly like ones you send
        manually.</li>
      </ul>

      <p style={{ marginTop: 40 }}>
        <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a> ·{" "}
        <a href="/">Back to Upfinity Sign</a>
      </p>
    </div>
  );
}
