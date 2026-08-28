// DEPLOY TO: app/dpa/page.tsx
//
// A Data Processing Agreement is standard, expected paperwork for any B2B
// product that processes personal data (here: Recipient PII) on a
// Customer's behalf — this is what an enterprise customer's own legal/
// procurement team will ask for before signing off on using the Service.
// Reviewed and approved by Upfinity.

export default function DataProcessingAgreementPage() {
  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "48px 24px 80px" }}>
      <a href="/" className="topbar-brand" style={{ display: "inline-block", marginBottom: 24 }}>Upfinity Sign</a>
      <h1>Data Processing Agreement</h1>
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Last updated: August 24, 2026</p>


      <p>
        This Data Processing Agreement ("DPA") forms part of, and is incorporated into, the{" "}
        <a href="/terms">Terms of Service</a> between Upfinity Inc. ("Upfinity," "Processor") and
        the Customer ("Controller") using Upfinity Sign (the "Service") to send documents to
        Recipients for signature. It reflects the actual processing the Service performs, not
        generic terms — see Section 4.
      </p>

      <h2>1. Roles</h2>
      <p>
        Where a Customer uses the Service to collect personal information from Recipients (names,
        emails, signatures, IP addresses, and the other data described in Section 4), the Customer
        is the <strong>data controller</strong> and Upfinity is the <strong>data processor</strong>,
        acting only on the Customer's documented instructions as set out in this DPA and the
        Customer's ordinary use of the Service's features.
      </p>

      <h2>2. Duration</h2>
      <p>
        This DPA remains in effect for as long as Upfinity processes personal data on the
        Customer's behalf under the Terms of Service, and survives termination for as long as
        Upfinity retains any such data (see Section 7).
      </p>

      <h2>3. Customer's instructions</h2>
      <p>
        Upfinity will process personal data only as necessary to provide the Service — sending
        envelopes, capturing signatures, generating certificates, delivering notifications — as
        configured and directed by the Customer through the Service's own features (templates,
        recipient fields, integrations), and as otherwise required by applicable law. If Upfinity
        believes an instruction violates applicable data protection law, it will notify the
        Customer before carrying it out.
      </p>

      <h2>4. Nature and purpose of processing</h2>
      <p><strong>Categories of data subjects:</strong> Recipients (people the Customer sends
      documents to) and the Customer's own workspace users.</p>
      <p><strong>Categories of personal data:</strong> name, email address, IP address,
      approximate geolocation, signature (typed text, drawn image, or uploaded image), content
      entered into document fields, and audit metadata (timestamps of each action taken).</p>
      <p><strong>Special categories of data:</strong> the Service is not designed to collect
      special categories of personal data (health, biometric beyond a signature image, etc.) and
      the Customer should not use document fields to collect such data unless it has independently
      assessed that doing so is appropriate and lawful.</p>
      <p><strong>Purpose:</strong> providing the e-signature and document workflow Service
      described in the Terms of Service.</p>

      <h2>5. Sub-processors</h2>
      <p>
        The Customer authorizes Upfinity to engage the categories of sub-processors listed in our{" "}
        <a href="/privacy">Privacy Policy</a> (Section 4) to provide the Service — currently
        covering payment processing, email delivery, cloud hosting, database hosting, file
        storage, AI processing (only for AI-assisted features the Customer chooses to use), and
        identity verification for enterprise single sign-on where configured. A list naming the
        specific companies behind each category is available on request as part of contracting.
        Upfinity will give the Customer at least 14 days' notice before adding a new sub-processor
        that will process personal data under this DPA, during which the Customer may object on
        reasonable data protection grounds; Upfinity will work in good faith to address the
        objection, which may include not proceeding with that sub-processor for the Customer's
        workspace.
      </p>

      <h2>6. Security measures</h2>
      <p>
        Upfinity maintains the technical and organizational measures described in our{" "}
        <a href="/privacy">Privacy Policy</a> (Section 9), including TLS encryption in transit,
        encrypted storage of sensitive credentials, role-based access controls, and an immutable
        audit trail. Upfinity will notify the Customer without undue delay after becoming aware of
        a personal data breach affecting the Customer's data, and will provide reasonably
        requested information to help the Customer meet its own breach notification obligations.
      </p>

      <h2>7. Data retention and deletion</h2>
      <p>
        Upfinity retains personal data as described in our <a href="/privacy">Privacy Policy</a>{" "}
        (Section 5) — a minimum of two years, longer where the Customer's plan tier, legal
        requirements, or an active legal hold requires it. On termination of the Customer's
        account and expiry of the required retention period, Upfinity will delete or anonymize the
        personal data it processed on the Customer's behalf, except where retention is required by
        law.
      </p>

      <h2>8. Assistance with data subject rights</h2>
      <p>
        Where a Recipient or workspace user contacts Upfinity directly to exercise a data
        protection right (access, correction, deletion, etc.), Upfinity will either direct them to
        the relevant Customer or, where appropriate, fulfill the request itself and notify the
        Customer. Upfinity will provide the Customer reasonable assistance in responding to such
        requests, given the nature of the processing and information available to Upfinity.
      </p>

      <h2>9. International transfers</h2>
      <p>
        Personal data is processed in the United States, as described in our{" "}
        <a href="/privacy">Privacy Policy</a> (Section 7). Where a transfer of personal data
        originating in the EU/UK to a jurisdiction not deemed adequate requires a lawful transfer
        mechanism, Upfinity relies on Standard Contractual Clauses or an equivalent mechanism with
        the relevant sub-processor.
      </p>

      <h2>10. Audit rights</h2>
      <p>
        Upon reasonable advance notice and no more than once per year (except following a security
        incident), Upfinity will make available information reasonably necessary to demonstrate
        compliance with this DPA, and will allow for and contribute to audits, including
        inspections, conducted by the Customer or an independent auditor mandated by the Customer,
        subject to confidentiality obligations and without unreasonably disrupting Upfinity's
        operations or other customers' data.
      </p>

      <h2>11. Liability</h2>
      <p>
        Liability under this DPA is subject to the limitation of liability provisions in the{" "}
        <a href="/terms">Terms of Service</a>.
      </p>

      <h2>12. Contact</h2>
      <p>
        Upfinity Inc.<br />
        140 Carlton Street, Toronto, ON M5A 3W7, Canada<br />
        <strong>privacy@upfinity.ca</strong>
      </p>

      <p style={{ marginTop: 40 }}>
        <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a> ·{" "}
        <a href="/ai-policy">AI Assistant Notice</a> · <a href="/">Back to Upfinity Sign</a>
      </p>
    </div>
  );
}
