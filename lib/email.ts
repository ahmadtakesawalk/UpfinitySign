// DEPLOY TO: lib/email.ts
//
// Delivery: Resend (primary) -> Gmail SMTP (fallback) -> dev console log
// (final fallback, so the app stays testable with nothing configured).
// Every layer is real, working code — no layer is a fake stub — but each
// only activates once its own env vars are set, same pattern as
// lib/storage and lib/llm.
//
// From-address resolution: an enterprise tenant with a platform-admin-
// verified custom email gets their own domain; everyone else gets the
// platform default (EMAIL_FROM, or the hardcoded fallback below if that's
// also unset). "Requested but not yet verified" never silently sends from
// an unverified domain — see resolveFromAddress().

import { config } from "./config";
import { prisma } from "./db";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

interface SendOptions {
  tenantId?: string; // when set, envelope emails can use that tenant's verified custom domain
}

export async function sendEmail(message: EmailMessage, opts: SendOptions = {}): Promise<void> {
  const from = await resolveFromAddress(opts.tenantId);

  if (!config.email.resendApiKey && !config.email.gmailUser) {
    // Dev fallback — logs instead of sending. This is what makes the
    // signing flow testable locally without an email account, but it also
    // means links never actually reach anyone until a provider is
    // configured — don't mistake "it works in dev" for "it emails people".
    console.log(
      JSON.stringify({ event: "email.dev_fallback_not_sent", to: message.to, from, subject: message.subject })
    );
    return;
  }

  const errors: string[] = [];

  if (config.email.resendApiKey) {
    try {
      await sendViaResend(message, from);
      return;
    } catch (err) {
      errors.push(`resend: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (config.email.gmailUser) {
    try {
      await sendViaGmail(message, from);
      return;
    } catch (err) {
      errors.push(`gmail: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`All configured email providers failed — ${errors.join("; ")}`);
}

/**
 * Enterprise tenants can send envelope emails from their own verified
 * domain instead of the platform default. "Verified" means a platform
 * admin has confirmed DNS/domain ownership (see AdminAuditLog action
 * "verify_tenant_email_domain") — a tenant setting a custom address in
 * Settings alone does NOT unlock it; that only marks it as requested.
 */
async function resolveFromAddress(tenantId?: string): Promise<string> {
  const platformDefault = process.env.EMAIL_FROM ?? "Upfinity Sign <noreply@upfinitysign.com>";
  if (!tenantId) return platformDefault;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return platformDefault;

  const eligible = tenant.tier === "enterprise" && tenant.customFromEmail && tenant.customFromEmailVerifiedAt;
  return eligible ? tenant.customFromEmail! : platformDefault;
}

async function sendViaResend(message: EmailMessage, from: string): Promise<void> {
  const apiKey = config.email.resendApiKey;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: message.to, subject: message.subject, html: message.html }),
  });

  if (!res.ok) {
    throw new Error(`Resend API error ${res.status}: ${await res.text()}`);
  }
}

/**
 * Gmail SMTP relay fallback — activates when RESEND_API_KEY is missing/
 * failing and GMAIL_USER + GMAIL_APP_PASSWORD are set (a Google Workspace
 * or Gmail account with an App Password, not the account's real password
 * — see https://myaccount.google.com/apppasswords). This is a genuine
 * fallback channel, not a primary provider: Gmail's sending limits (500
 * msgs/day on a standard account) make it unsuitable as the only path at
 * any real volume, which is exactly why it's the fallback and not the
 * default.
 */
let cachedTransporter: import("nodemailer").Transporter | null = null;

async function getGmailTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const nodemailer = await import("nodemailer");
  // Explicit SMTP config rather than the `service: "gmail"` shorthand —
  // functionally identical, but avoids a strict-mode type mismatch on
  // some nodemailer versions' overload resolution for the shorthand form.
  cachedTransporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: config.email.gmailUser!, pass: config.email.gmailAppPassword! },
  });
  return cachedTransporter;
}

async function sendViaGmail(message: EmailMessage, from: string): Promise<void> {
  if (!config.email.gmailAppPassword) {
    throw new Error("GMAIL_USER is set but GMAIL_APP_PASSWORD is missing");
  }
  const transporter = await getGmailTransporter();
  // Gmail SMTP always sends as the authenticated account's own address —
  // it can't spoof an arbitrary "from" the way an API-based provider can.
  // The resolved platform/enterprise `from` is preserved as the display
  // name and a Reply-To, so replies still land somewhere sensible, but the
  // envelope-from is honestly the Gmail account, not a forged domain.
  await transporter.sendMail({
    from: `"${from.replace(/<.*>/, "").trim() || "Upfinity Sign"}" <${config.email.gmailUser}>`,
    replyTo: from.match(/<(.+)>/)?.[1] ?? from,
    to: message.to,
    subject: message.subject,
    html: message.html,
  });
}

export function emailForRole(
  role: "signer" | "approver" | "cc",
  recipientName: string,
  url: string,
  documentName: string,
  isReminder = false
): EmailMessage {
  if (role === "approver") {
    return {
      to: "", // caller fills in `to` — this only picks subject/html
      subject: isReminder ? `Reminder: ${documentName} needs your approval` : `${documentName} — approval needed`,
      html: approvalRequestEmail(recipientName, url, documentName),
    };
  }
  if (role === "cc") {
    return { to: "", subject: `${documentName} — copied for your records`, html: ccNotificationEmail(recipientName, url, documentName) };
  }
  return {
    to: "",
    subject: isReminder ? `Reminder: ${documentName} still needs your signature` : `${documentName} — please review and sign`,
    html: signingRequestEmail(recipientName, url, documentName),
  };
}

export function signingRequestEmail(recipientName: string, signingUrl: string, documentName: string): EmailMessage["html"] {
  return roleEmailTemplate(recipientName, signingUrl, documentName, {
    heading: "You have a document to review and sign",
    cta: "Review & Sign",
  });
}

export function approvalRequestEmail(recipientName: string, signingUrl: string, documentName: string): EmailMessage["html"] {
  return roleEmailTemplate(recipientName, signingUrl, documentName, {
    heading: "A document is waiting for your approval before it goes to signers",
    cta: "Review & Approve",
  });
}

export function ccNotificationEmail(recipientName: string, viewUrl: string, documentName: string): EmailMessage["html"] {
  // No action needed — this is a copy, not a request. Different CTA wording
  // on purpose so a cc'd recipient doesn't think they need to sign anything.
  return roleEmailTemplate(recipientName, viewUrl, documentName, {
    heading: "You've been copied on this document",
    cta: "View Document",
  });
}

function roleEmailTemplate(
  recipientName: string,
  url: string,
  documentName: string,
  copy: { heading: string; cta: string }
): string {
  // Deliberately plain — the "Claude-like" design pass hasn't been applied
  // to transactional email yet, same as the rest of the UI (see PRD §12).
  return `
    <p>Hi ${escapeHtml(recipientName)},</p>
    <p>${escapeHtml(copy.heading)}: <strong>${escapeHtml(documentName)}</strong></p>
    <p><a href="${url}">${escapeHtml(copy.cta)}</a></p>
    <p style="color:#888;font-size:12px;">Sent via Upfinity Sign</p>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// Sent when a recipient opens a signing link for the first time — a second
// factor beyond the link itself (see Recipient.otpCodeHash in schema.prisma
// for why). Deliberately plain, matching roleEmailTemplate's own note about
// transactional email styling.
export function signingOtpEmail(recipientName: string, documentName: string, code: string): string {
  return `
    <p>Hi ${escapeHtml(recipientName)},</p>
    <p>Use this code to open <strong>${escapeHtml(documentName)}</strong>:</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0;">${escapeHtml(code)}</p>
    <p style="color:#888;font-size:12px;">Expires in 10 minutes. If you didn't request this, you can ignore this email — no one can open the document without this code.</p>
    <p style="color:#888;font-size:12px;">Sent via Upfinity Sign</p>
  `;
}
