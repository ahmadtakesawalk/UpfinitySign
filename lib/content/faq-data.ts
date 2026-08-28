// DEPLOY TO: lib/content/faq-data.ts
//
// Single source of truth for the full FAQ library (app/faq/page.tsx).
// The landing page's FAQ teaser (app/page.tsx) is deliberately a
// separate, smaller set of marketing-phrased highlights, not pulled from
// here — the two serve different purposes (a punchy hook vs. an
// operational reference) and forcing shared text would make one or the
// other worse. Keep the *facts* consistent between them by hand if either
// changes; the wording is meant to differ.

export interface FaqEntry {
  q: string;
  bullets: string[];
}

export interface FaqCategory {
  name: string;
  entries: FaqEntry[];
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    name: "Getting started",
    entries: [
      {
        q: "How do I create an account?",
        bullets: [
          "Click \"Create free account\" — sign up with email/password, or continue with Google or Microsoft",
          "First time with Google/Microsoft? You'll name your workspace, then you're in",
        ],
      },
      {
        q: "How do I sign in?",
        bullets: [
          "Just your email and password, or Google/Microsoft — no workspace name to remember",
          "One workspace on that email → straight to your password",
          "More than one workspace on that email → you'll be asked which one",
        ],
      },
      {
        q: "Do I need a template before I can send something?",
        bullets: [
          "Yes — a template is a document with fields placed on it",
          "Upload a PDF or Word doc — fields are suggested automatically",
          "Or describe what you need to the AI assistant — it drafts one from scratch for you to review",
          "Or start from a common template (NDA, offer letter, service agreement, waiver) — ready to customize",
        ],
      },
      {
        q: "What plans are available?",
        bullets: [
          "Every workspace starts with a 60-day free trial — full access, no card required",
          "Day 45: a payment method is required to keep sending (existing documents and account access stay untouched either way)",
          "Starter, Business, Enterprise each step up your monthly envelope & AI allowance, document retention, and add-ons (bulk send, ID verification, custom branding)",
          "Exact numbers and your trial status: Settings → Plan",
        ],
      },
      {
        q: "What happens when my trial ends?",
        bullets: [
          "Card on file → auto-converts to a paid plan, card charged (price & date shown in Settings in advance; cancel anytime before then, no penalty)",
          "No card → workspace pauses (not deleted) until you add one — add a card anytime to pick up exactly where you left off",
        ],
      },
    ],
  },
  {
    name: "Sending",
    entries: [
      {
        q: "How do I send a document for signature?",
        bullets: [
          "Dashboard → Create envelope → choose a template → add each recipient's name and email → send",
          "Each recipient gets a secure email link — no account needed on their end",
        ],
      },
      {
        q: "Can I control the signing order?",
        bullets: [
          "Yes — fields are tied to roles (Signer 1, Signer 2, Approver...)",
          "Recipients are notified in order; each one only gets access once everyone before them has acted",
        ],
      },
      {
        q: "Can I send the same document to a big list of people at once?",
        bullets: [
          "Yes — use Bulk send (next to Create envelope)",
          "Upload a CSV — one envelope gets created per row, all from the same template",
        ],
      },
      {
        q: "Can people fill in their own info and just sign, without me creating each envelope?",
        bullets: [
          "Yes, for single-signer templates — enable a self-serve link in the template builder",
          "Anyone with the link enters their own name/email and lands directly in their signing flow",
          "Good fit: delivery receipts, standard waivers — anything where you don't need to name the recipient ahead of time",
        ],
      },
      {
        q: "Can I collect a payment as part of signing?",
        bullets: [
          "Yes, once you've connected a payment account (Settings → Payment collection)",
          "Add a payment field with a fixed amount — recipient pays before completing signing",
          "Money goes directly to your own connected payment account",
        ],
      },
      {
        q: "Does a recipient signing in front of me need to check their email?",
        bullets: [
          "No — open the envelope, click \"Sign in person\" next to their name, and hand them your device",
          "No email wait — good for a walk-up signature",
        ],
      },
      {
        q: "What if a recipient doesn't act in time?",
        bullets: [
          "Envelopes default to a 14-day window (adjustable per envelope)",
          "An automatic reminder goes out if a recipient's gone quiet for a couple of days — no manual chasing needed",
        ],
      },
      {
        q: "Can I cancel a document after sending it?",
        bullets: [
          "Yes — void it from the envelope's detail page any time before it's completed",
          "Recipients who haven't acted yet lose access immediately",
        ],
      },
    ],
  },
  {
    name: "The AI assistant",
    entries: [
      {
        q: "What can it actually do?",
        bullets: [
          "Edit fields on a document you've already uploaded — e.g. \"add a phone number field near the bottom of page 2\"",
          "Draft a new document from a description — e.g. \"draft an NDA for a contractor, standard mutual terms\"",
          "Either way: it shows exactly what it's about to do and waits for your confirmation first — you always decide",
        ],
      },
      {
        q: "Can I ask it questions about my account instead?",
        bullets: [
          "Yes — switch to \"Ask about my account\" in the same panel",
          "Examples: \"how many envelopes have I sent this month,\" \"what's on my current plan\" — answered instantly from your own data",
        ],
      },
      {
        q: "How is this different from just uploading a document myself?",
        bullets: [
          "Most e-signature tools make you manually place every field by hand",
          "Here: describe what you need in plain English → get a complete, properly-fielded document in seconds",
          "Or upload one and fields get suggested automatically the moment it lands",
        ],
      },
      {
        q: "Does using the assistant cost extra?",
        bullets: [
          "No separate subscription — included in every plan with a monthly allowance",
          "Need more? Buy additional capacity anytime in Settings → Usage & credits",
        ],
      },
    ],
  },
  {
    name: "Templates",
    entries: [
      {
        q: "How does field placement work?",
        bullets: [
          "Upload a document → fields are suggested automatically from the content",
          "Confirm, move, resize, add, or remove anything in the builder — or just ask the AI assistant to make the change",
        ],
      },
      {
        q: "Can a field only show up sometimes?",
        bullets: [
          "Yes — conditional fields: \"Show only if [another field] equals [value]\"",
          "Example: show a \"Home address\" field only if \"Remote\" is checked",
        ],
      },
      { q: "Can I organize templates into folders?", bullets: ["Yes — create, rename, and file templates from the Templates page"] },
      { q: "Can I duplicate a template?", bullets: ["Yes, one click from the builder — useful for a near-identical variant with a small tweak"] },
      {
        q: "Can I delete a template?",
        bullets: [
          "Yes, as long as no envelope has ever been sent from it (keeps that envelope's history intact)",
          "Already has send history? Duplicate it and archive the original instead",
        ],
      },
      {
        q: "What file types can I upload?",
        bullets: [
          "PDF and Word (.docx)",
          "Word documents are automatically converted, preserving headings, formatting, and tables",
        ],
      },
    ],
  },
  {
    name: "Signing a document",
    entries: [
      {
        q: "I got a signing link — what do I do?",
        bullets: [
          "Open it and fill in each highlighted field directly on the document",
          "No login, no app download — works in any browser, desktop or mobile",
          "Required fields are marked; you can't submit until they're complete",
        ],
      },
      { q: "How do I sign — type, draw, or upload?", bullets: ["All three, your choice, right where you click to sign"] },
      { q: "What if I need to decline?", bullets: ["There's a decline option on the signing page — the sender is notified immediately with your reason"] },
      {
        q: "Is my signature legally valid?",
        bullets: [
          "Full audit metadata captured — timestamp, IP address, verification method",
          "Final signed PDF carries a real embedded digital signature, not just a database record",
          "Every completed envelope gets its own Certificate of Completion documenting the full chain of custody",
        ],
      },
    ],
  },
  {
    name: "Team & account",
    entries: [
      { q: "How do I invite teammates?", bullets: ["Settings → Team → Invite — they'll get an email to set up their own login under your workspace"] },
      {
        q: "How do I get an API key?",
        bullets: [
          "Settings → API Keys → Create key",
          "The raw key is shown exactly once — copy it immediately (revoke and create a new one if you lose it)",
        ],
      },
      {
        q: "How does Upfinity Sign integrate with other platforms, like Upfinity Talent?",
        bullets: [
          "An API lets the other platform send documents on your behalf",
          "A webhook tells it the moment something's signed — no polling, either direction",
          "From your team's side: sending a document can be one click, inside whatever platform you're already using",
        ],
      },
      { q: "Do API-sent envelopes show up in my own dashboard?", bullets: ["Yes — exactly like one you sent manually, including audit trail and usage counts"] },
      { q: "Can I use my own domain for sending emails?", bullets: ["Enterprise plans only — request it in Settings; once verified, recipients see your domain, not a generic one"] },
      { q: "Can I add custom branding?", bullets: ["Yes, as an add-on on eligible plans — your own logo on recipients' signing pages"] },
      { q: "Can I export or delete my data?", bullets: ["Yes, anytime — Settings → Danger zone, full export or deletion request, your choice"] },
      {
        q: "How long is my data kept?",
        bullets: [
          "1 year on Free, up to 7 years on Enterprise — depends on your plan",
          "You can always export before it's purged",
        ],
      },
    ],
  },
  {
    name: "Billing",
    entries: [
      {
        q: "What happens if I hit my plan's limits (envelopes or AI messages)?",
        bullets: [
          "You'll see it coming in Settings before you hit it",
          "Once over: buy a top-up pack or upgrade — never silently blocked with no way to continue",
        ],
      },
      { q: "Are payments secure?", bullets: ["Yes — all processing runs through our payment processor; Upfinity never sees or stores your card details"] },
      {
        q: "Where do I find my invoices and receipts?",
        bullets: [
          "Settings → Invoices & receipts — every charge gets a branded PDF, permanently available there",
          "Optional: email yourself a copy — the invoice stays in your dashboard either way, that's just an extra",
        ],
      },
      {
        q: "What if my payment fails?",
        bullets: [
          "We email you and retry automatically",
          "Repeated failures → workspace pauses (never deleted) until you update your payment method",
          "Updating it resumes things immediately, no waiting",
        ],
      },
      {
        q: "Can I get a refund?",
        bullets: [
          "Contact Upfinity in Settings — we'll take care of it",
          "Refunded to your original payment method, with a credit note added to your invoice history",
        ],
      },
      { q: "Is tax included in my charges?", bullets: ["Where it applies, it's calculated and shown as its own line on your invoice — never bundled invisibly into the total"] },
    ],
  },
  {
    name: "Getting help",
    entries: [
      {
        q: "How do I contact Upfinity directly?",
        bullets: [
          "Settings → Contact Upfinity — send a message straight to our team",
          "You get an immediate confirmation; we follow up at the email on your account once it's answered",
        ],
      },
    ],
  },
];
