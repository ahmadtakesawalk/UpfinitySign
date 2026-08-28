// DEPLOY TO: app/ai-policy/page.tsx
//
// The full version of the notice — the compact in-product version
// (components/assistant/AssistantChatPanel.tsx) links here for detail.
// Reviewed and approved by Upfinity.

export default function AiAssistantNoticePage() {
  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "48px 24px 80px" }}>
      <a href="/" className="topbar-brand" style={{ display: "inline-block", marginBottom: 24 }}>Upfinity Sign</a>
      <h1>AI Assistant Notice</h1>
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Last updated: August 24, 2026</p>

      <p>
        This notice explains what happens whenever AI is involved in the Service — not just the
        assistant panel — and supplements, and should be read alongside, our{" "}
        <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms of Service</a>.
      </p>

      <h2>Where AI shows up</h2>
      <p>
        Three distinct places, not just the chat panel:
      </p>
      <ul>
        <li><strong>Automatic field suggestions on upload</strong> — every PDF or Word document you
        upload is analyzed to suggest field placements before you touch anything. This happens
        automatically on every upload; every suggested field can be freely edited, moved, or
        removed in the builder, and you're never required to keep an AI-suggested field as-is.</li>
        <li><strong>The assistant panel</strong> — proposes edits to fields on a document you've
        already uploaded, or drafts a new document's content from a written description you give
        it. It always describes exactly what it's proposing and waits for your explicit
        confirmation before anything is applied — nothing changes automatically here.</li>
        <li><strong>"Ask about my account"</strong> — a separate mode that answers factual
        questions about your own workspace data (envelope counts, plan usage) and never proposes
        or applies changes of any kind.</li>
      </ul>

      <h2>What data is sent, and to whom</h2>
      <p>
        We use more than one AI provider — which one handles a given request depends on the
        feature and our own configuration at the time, not a single fixed vendor. Regardless of
        which is active, the same limits apply: for field suggestions and the assistant panel, we
        send your message text (where applicable) and a summary of the current document's field
        layout — field types, roles, and positions, not recipient names or email addresses, since
        templates don't have real recipients attached until you actually send one. For account
        questions, we send only the specific statistics needed to answer (e.g., your plan tier and
        envelope counts by status).
      </p>
      <p>
        We do not send the content of documents unrelated to the one you're actively working on,
        and we do not send other tenants' data. Your conversations and document content are not
        used to train any underlying AI model. Beyond that, how long each provider itself retains
        request data, and under what terms, is governed by our contract with that provider as our
        sub-processor — see our <a href="/privacy">Privacy Policy</a> for the general sub-processor
        and international-transfer terms that apply here too, since AI providers are not exempt
        from those.
      </p>
      <p>
        Your own copy of assistant conversation history is retained for as long as your account is
        active, so it remains available to you in that panel, and deleted on the same schedule as
        the rest of your account data if you close your workspace — see our{" "}
        <a href="/privacy">Privacy Policy</a> (Section 5) for the exact retention terms.
      </p>

      <h2>What a recipient should know</h2>
      <p>
        If you're signing a document, not sending one: some or all of a document's content or
        field layout may have been generated or suggested by AI at the sender's direction, subject
        to the sender's own review before it was sent to you. This does not change your rights —
        you can review the full document before signing, decline to sign, and the same audit trail
        and Certificate of Completion apply regardless of how the document was originally drafted.
        Upfinity does not use AI to make decisions about you, evaluate your signature, or
        automatically act on your behalf at any point in the signing process.
      </p>

      <h2>Accuracy — please read this part</h2>
      <p>
        AI-generated content, especially document text drafted from a description, is a starting
        point, not a finished, legally reviewed document. It may be inaccurate, incomplete, or
        unsuitable for your specific situation, and it does not constitute legal advice. This is
        why the Service enforces a mandatory human review step before any AI-drafted document can
        be sent — you must explicitly mark it reviewed first — but that enforcement doesn't
        replace your own judgment about whether the content is actually correct and appropriate to
        use.
      </p>

      <h2>Usage and cost</h2>
      <p>
        The assistant panel and "Ask about my account" are metered against your plan's monthly AI
        allowance — see Settings → Usage &amp; credits for your current usage and to purchase
        additional capacity if needed. Automatic field suggestions on upload are not metered or
        counted against that allowance.
      </p>

      <h2>Questions</h2>
      <p>Contact us at <strong>privacy@upfinity.ca</strong>.</p>

      <p style={{ marginTop: 40 }}>
        <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a> ·{" "}
        <a href="/dpa">Data Processing Agreement</a> · <a href="/">Back to Upfinity Sign</a>
      </p>
    </div>
  );
}
