// Upfinity Sign — central configuration.
// Every environment-dependent or product-tunable value is read through this
// file. Feature code imports from here, never `process.env` directly, so
// there is exactly one place to see (and change) how the app is configured.

export type StorageProvider = "vercel-blob" | "r2";
export type SigningCertMode = "self-signed" | "digicert";

export const config = {
  storage: {
    provider: (process.env.STORAGE_PROVIDER as StorageProvider) ?? "vercel-blob",
  },
  signing: {
    // self-signed until go-live decision — see PRD.md §7. Swapping to
    // "digicert" only requires setting this + the DIGICERT_* env vars;
    // no code change.
    certMode: (process.env.SIGNING_CERT_MODE as SigningCertMode) ?? "self-signed",
    kmsKeyId: process.env.SIGNING_KEY_KMS_ID ?? null,
    timestampAuthorityUrl:
      process.env.TIMESTAMP_AUTHORITY_URL ?? "https://freetsa.org/tsr", // free RFC 3161 TSA, swap for a paid one at scale
  },
  envelopes: {
    defaultExpiryHours: 24 * 14, // 14 days
    reminderAfterHours: 48,
  },
  // Free-tier trial: 60 days from signup, no card required for the first
  // 45 — after that, a card must be on file to keep sending (existing
  // envelopes/data stay accessible either way, this only gates NEW
  // sends). At day 60, a tenant with a card converts automatically to
  // the tier named below; without one, the account is suspended (not
  // deleted) until a card is added. See lib/billing/trial.ts.
  trial: {
    lengthDays: 60,
    cardRequiredAfterDays: 45,
    autoConvertToTier: "starter" as const,
  },
  // Tier limits — the ONLY place envelope caps, add-on availability, and
  // retention windows are defined. Billing logic and UI both read from here.
  // See PRD.md §6.
  tiers: {
    free: { envelopesPerMonth: 5, aiMessagesPerMonth: 10, retentionYears: 1, addons: [] as string[] },
    starter: { envelopesPerMonth: 50, aiMessagesPerMonth: 50, retentionYears: 3, addons: ["bulk_send"] },
    business: {
      envelopesPerMonth: 500,
      aiMessagesPerMonth: 300,
      retentionYears: 5,
      addons: ["bulk_send", "id_verification", "api_access"],
    },
    enterprise: {
      envelopesPerMonth: Infinity,
      aiMessagesPerMonth: Infinity,
      retentionYears: 7,
      addons: ["bulk_send", "id_verification", "api_access", "custom_branding", "byok"],
    },
  },
  webhooks: {
    hmacAlgo: process.env.WEBHOOK_HMAC_ALGO ?? "sha256",
    maxRetries: 5,
  },
  rateLimit: {
    // Per tenant, per minute, across all /api/v1/* routes. See lib/rate-limit.ts.
    requestsPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120),
    // Much tighter — login/password-reset attempts, keyed by IP (+ email
    // where applicable), to stop credential brute-forcing specifically.
    loginAttemptsPerMinute: Number(process.env.LOGIN_RATE_LIMIT_PER_MINUTE ?? 8),
  },
  monitoring: {
    sentryDsn: process.env.SENTRY_DSN ?? null, // captureException() in lib/monitoring.ts is a no-op until this is set
  },
  email: {
    // Both are optional and independent — set either or both. Resend is
    // tried first when both are configured; Gmail only activates as a
    // fallback (see lib/email.ts for why it's never the primary path).
    resendApiKey: process.env.RESEND_API_KEY ?? null,
    gmailUser: process.env.GMAIL_USER ?? null,
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD ?? null,
  },
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? null,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? null,
    },
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID ?? null,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? null,
      // Azure AD tenant to authorize against — "common" accepts both work/
      // school and personal Microsoft accounts, the right default for a
      // product that doesn't yet know which org a new signup belongs to.
      tenant: process.env.MICROSOFT_TENANT_ID ?? "common",
    },
  },
};

export type Config = typeof config;
