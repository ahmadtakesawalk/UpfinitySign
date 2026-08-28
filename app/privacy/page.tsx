// DEPLOY TO: app/privacy/page.tsx
//
// Reviewed and approved by Upfinity — reflects this product's actual data
// practices.

export default function PrivacyPolicyPage() {
  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "48px 24px 80px" }}>
      <a href="/" className="topbar-brand" style={{ display: "inline-block", marginBottom: 24 }}>Upfinity Sign</a>
      <h1>Privacy Policy</h1>
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Last updated: August 24, 2026</p>


      <p>
        This Privacy Policy explains how Upfinity Inc. ("Upfinity," "we," "us") collects, uses,
        discloses, and protects information in connection with Upfinity Sign, our e-signature and
        document-workflow platform (the "Service"). It applies to workspace owners and their team
        members ("Customers"), and to the people Customers send documents to for signature
        ("Recipients"), who may never create an account of their own.
      </p>

      <h2>1. Who this applies to, and how</h2>
      <p>
        If you're a <strong>Customer</strong> (you or your organization created a workspace),
        this Policy governs your account information and how you use the Service. If you're a
        <strong> Recipient</strong> (someone sent a document to sign, review, or approve), this
        Policy governs the personal information collected from you during that process — you did
        not choose to use Upfinity Sign, but we still owe you a clear account of what happens to
        your information, and you have real rights over it (Section 8). Where a Customer directs
        us to process a Recipient's information on their behalf, the Customer is the data
        controller and Upfinity acts as data processor — see our{" "}
        <a href="/dpa">Data Processing Agreement</a> for how that responsibility is divided.
      </p>

      <h2>2. Information we collect</h2>
      <p><strong>Account &amp; workspace information (Customers):</strong> name, email address,
      password (stored as a salted hash, never in plain text — or, if you sign in with Google or
      Microsoft, we receive your verified email and name from that provider and never see your
      password at all), company/workspace name, role within your workspace, billing and plan
      information.</p>
      <p><strong>Recipient information:</strong> name and email address (provided by the sender),
      the content you enter into document fields, your signature (typed, drawn, or an uploaded
      image — never a scan of a handwritten signature on paper unless you choose to upload one),
      IP address, approximate geolocation derived from that IP, browser/device information, and
      timestamps of every action you take (opened, filled a field, signed, declined) — this audit
      trail is what makes a signature legally defensible, not incidental data collection.</p>
      <p><strong>Document content:</strong> the documents you upload or generate through the
      Service, and the completed, signed versions of them.</p>
      <p><strong>Payment information:</strong> processed entirely by our payment processor — we
      never receive or store your full card number. We retain only what's provided back to us
      (e.g., a payment confirmation, the last 4 digits for your reference).</p>
      <p><strong>AI assistant usage:</strong> if you use the in-product AI assistant (to place
      fields or draft a document from a description), the text you send it and the document
      context needed to respond are sent to our AI provider to generate a response, and retained
      for as long as your account is active so your conversation history remains available to you
      in that panel — see our <a href="/ai-policy">AI Assistant Notice</a> for the specifics.</p>
      <p><strong>Technical &amp; usage information:</strong> log data, API usage, and the minimum
      cookies needed to keep you signed in (Section 6).</p>

      <h2>3. How we use information</h2>
      <ul>
        <li>To provide the Service — creating and delivering envelopes, capturing signatures,
        generating the signed document and Certificate of Completion, sending notifications and
        reminders.</li>
        <li>To maintain the audit trail that makes a signature legally defensible — this is a
        core part of what the Service is for, not a secondary use.</li>
        <li>To process payments and manage billing, via our payment processor.</li>
        <li>To provide AI-assisted features you choose to use.</li>
        <li>To detect and prevent fraud, abuse, and security incidents.</li>
        <li>To comply with legal obligations, including retention requirements described in
        Section 5.</li>
        <li>To communicate with you about the Service — service notices, security alerts,
        billing. We do not sell personal information, and we do not use Recipient information for
        advertising.</li>
      </ul>

      <h2>4. Who we share information with</h2>
      <p>
        We do not sell or share personal information for cross-context behavioral advertising. We
        share it only with the categories of service providers (sub-processors) below, each bound
        by contract to protect it and use it only to provide their service to us. We don't publish
        the specific companies behind each category here, for the same reason a bank doesn't
        publish its network diagram — but a full named list is available under our{" "}
        <a href="/dpa">Data Processing Agreement</a> for customers who need it for their own
        compliance review.
      </p>
      <ul>
        <li><strong>Payment processing</strong> — including, for tenants who enable it, direct
        payment collection during signing, routed to that tenant's own connected account, never
        through Upfinity.</li>
        <li><strong>Email delivery</strong> — signing requests, reminders, and notifications.</li>
        <li><strong>Cloud application hosting.</strong></li>
        <li><strong>Database hosting.</strong></li>
        <li><strong>Document and file storage.</strong></li>
        <li><strong>AI processing</strong> — for AI-assisted field placement and the AI assistant,
        only when you use those features.</li>
        <li><strong>Identity verification</strong> — for enterprise single sign-on, where
        configured, or your organization's own identity provider.</li>
        <li><strong>Google / Microsoft</strong> — if you choose to sign in that way (named
        specifically since you're the one choosing and interacting with them directly, not a
        background sub-processor).</li>
      </ul>
      <p>
        A specifically-named list of sub-processors is available to customers on request as part
        of contracting — see our <a href="/dpa">Data Processing Agreement</a>. We'll provide
        advance notice before adding a new sub-processor that will handle Customer or Recipient
        personal data.
      </p>
      <p>
        We may also disclose information if required by law, to protect the rights, property, or
        safety of Upfinity, our users, or the public, or in connection with a merger, acquisition,
        or sale of assets (with notice to affected users where required).
      </p>

      <h2>5. How long we keep information</h2>
      <p>
        We retain envelope and document data for a <strong>minimum of two (2) years</strong>,
        and longer where your plan tier, your jurisdiction's requirements, or an active legal
        matter requires it — our published tiers currently retain data for up to seven years on
        Enterprise plans. A workspace can place a <strong>legal hold</strong> on a specific
        document to exempt it from deletion entirely — for example, while it's the subject of a
        dispute — until that hold is explicitly released.
      </p>
      <p>
        If you request deletion of your account or data (Section 8), we begin a 30-day grace
        period, after which we delete what we can — but any document still within its required
        retention window, or under an active legal hold, is retained until that period lawfully
        ends, not deleted immediately just because deletion was requested.
      </p>

      <h2>6. Cookies</h2>
      <p>We use a small, fixed set of cookies — no third-party advertising or tracking cookies:</p>
      <ul>
        <li><strong>Tenant session</strong> — keeps you signed in to your workspace (HMAC-signed,
        httpOnly).</li>
        <li><strong>Admin session</strong> — the equivalent for platform staff, entirely separate
        from the tenant session above.</li>
        <li><strong>OAuth state</strong> — a short-lived (10-minute) cookie used only during
        Google/Microsoft/SSO sign-in to prevent request forgery; it's deleted immediately once
        sign-in completes.</li>
      </ul>
      <p>
        Disabling cookies in your browser will prevent you from staying signed in. We do not
        currently respond to browser "Do Not Track" signals, as no common industry standard for
        interpreting them has been adopted — this has no practical effect for you either way, since
        we don't use tracking cookies to begin with.
      </p>

      <h2>7. International data transfers</h2>
      <p>
        Our infrastructure is hosted in the United States. If you're accessing the Service from
        outside the United States, your information will be transferred to, stored, and processed
        in the United States, which may have data protection laws different from those of your
        home jurisdiction. Where required for transfers of personal data originating in the
        EU/UK, we rely on Standard Contractual Clauses or an equivalent lawful transfer mechanism
        with our sub-processors — see our <a href="/dpa">Data Processing Agreement</a>.
      </p>

      <h2>8. Your rights and choices</h2>
      <p>
        Depending on where you live, you may have rights including:
      </p>
      <ul>
        <li><strong>Access</strong> — a copy of the personal information we hold about you;</li>
        <li><strong>Correction</strong> — fixing inaccurate information;</li>
        <li><strong>Deletion</strong> — subject to the retention limits in Section 5;</li>
        <li><strong>Portability</strong> — receiving your data in a portable format;</li>
        <li><strong>Objection / restriction</strong> — objecting to or limiting certain
        processing;</li>
        <li><strong>Withdrawing consent</strong> — where processing depends on it;</li>
        <li><strong>Non-discrimination</strong> — we will not penalize you for exercising any of
        the above.</li>
      </ul>
      <p>
        This includes rights under the EU/UK GDPR and the California Consumer Privacy Act, among
        other applicable frameworks. To exercise any of these rights — whether you're a Customer or
        a Recipient who never created an account — contact us at{" "}
        <strong>privacy@upfinity.ca</strong>. <strong>We will respond within 30 days</strong>{" "}
        (or sooner where a shorter period applies under law). Customers can also export or request
        deletion of their workspace data directly from Settings → Danger zone. We will honor
        deletion requests except where retaining information is required by law, by an active
        legal hold, or to complete a transaction already in progress.
      </p>
      <p>
        <strong>EU/UK representative:</strong> for the purposes of Article 27 GDPR and the UK GDPR,
        Upfinity Inc. acts as its own representative and can be contacted using the details in
        Section 12.
      </p>

      <h2>9. Security</h2>
      <p>
        We encrypt data in transit (TLS is enforced on every connection to our database and
        between your browser and our servers) and apply access controls, encrypted storage for
        sensitive credentials (API keys, single sign-on secrets, recipient access tokens), and an
        immutable audit trail across the Service. No system is perfectly secure; we will notify
        affected users and relevant authorities of a security breach without undue delay and, in
        any event, as required by applicable law.
      </p>

      <h2>10. Children's privacy</h2>
      <p>
        The Service is not directed to, and we do not knowingly collect personal information
        from, children under the age of 16. If you believe a child has provided us with personal
        information, contact privacy@upfinity.ca and we will delete it.
      </p>

      <h2>11. Changes to this policy</h2>
      <p>
        We may update this Policy from time to time. We'll post the updated version here with a
        new "Last updated" date, and where a change is material, we'll provide more prominent
        notice (such as an email to workspace owners) at least 30 days before it takes effect.
      </p>

      <h2>12. Contact us</h2>
      <p>
        Upfinity Inc.<br />
        140 Carlton Street, Toronto, ON M5A 3W7, Canada<br />
        <strong>privacy@upfinity.ca</strong>
      </p>

      <p style={{ marginTop: 40 }}>
        <a href="/terms">Terms of Service</a> · <a href="/dpa">Data Processing Agreement</a> ·{" "}
        <a href="/ai-policy">AI Assistant Notice</a> · <a href="/">Back to Upfinity Sign</a>
      </p>
    </div>
  );
}
