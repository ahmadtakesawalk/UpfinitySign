// DEPLOY TO: lib/oauth.ts
//
// Google and Microsoft OAuth 2.0 / OIDC — real, working protocol code for
// both. Neither activates until you register an OAuth app with that
// provider and set the client ID/secret env vars — same pattern as every
// other provider integration in this codebase (Resend, Stripe, DigiCert).
//
// Sign-in-with-Google/Microsoft has to solve one problem email/password
// signup doesn't: we don't know the person's company name from an OAuth
// profile. So the flow is: verify identity with the provider, THEN either
// log them into an existing tenant (if their verified email already has a
// TenantUser row) or hand them to a short "name your workspace" step to
// finish creating one — never silently invent a company name for them.

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { config } from "./config";

export type OAuthProvider = "google" | "microsoft";

export interface OAuthProfile {
  email: string;
  name: string;
  provider: OAuthProvider;
}

function providerConfig(provider: OAuthProvider) {
  return provider === "google" ? config.oauth.google : config.oauth.microsoft;
}

export function isProviderConfigured(provider: OAuthProvider): boolean {
  const c = providerConfig(provider);
  return Boolean(c.clientId && c.clientSecret);
}

function redirectUri(provider: OAuthProvider): string {
  return `${config.appUrl}/api/auth/${provider}/callback`;
}

/** Builds the URL to send the browser to for the provider's consent screen. State is a CSRF nonce the callback re-checks against a short-lived cookie. */
export function buildAuthUrl(provider: OAuthProvider, state: string): string {
  const redirect = redirectUri(provider);

  if (provider === "google") {
    const params = new URLSearchParams({
      client_id: config.oauth.google.clientId!,
      redirect_uri: redirect,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  const params = new URLSearchParams({
    client_id: config.oauth.microsoft.clientId!,
    redirect_uri: redirect,
    response_type: "code",
    scope: "openid email profile User.Read",
    state,
    response_mode: "query",
  });
  return `https://login.microsoftonline.com/${config.oauth.microsoft.tenant}/oauth2/v2.0/authorize?${params}`;
}

/** Exchanges the callback's authorization code for the person's verified email + name. Throws on any failure — callers show a generic "sign-in failed" rather than leak provider error details. */
export async function exchangeCodeForProfile(provider: OAuthProvider, code: string): Promise<OAuthProfile> {
  const redirect = redirectUri(provider);

  if (provider === "google") {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.oauth.google.clientId!,
        client_secret: config.oauth.google.clientSecret!,
        code,
        redirect_uri: redirect,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(`Google token exchange failed: ${tokenRes.status}`);
    const { access_token } = await tokenRes.json();

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${access_token}` },
    });
    if (!profileRes.ok) throw new Error(`Google userinfo fetch failed: ${profileRes.status}`);
    const profile = await profileRes.json();
    if (!profile.email_verified) throw new Error("Google account email is not verified");
    return { email: profile.email, name: profile.name ?? profile.email, provider: "google" };
  }

  const tokenRes = await fetch(`https://login.microsoftonline.com/${config.oauth.microsoft.tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.oauth.microsoft.clientId!,
      client_secret: config.oauth.microsoft.clientSecret!,
      code,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) throw new Error(`Microsoft token exchange failed: ${tokenRes.status}`);
  const { access_token } = await tokenRes.json();

  const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) throw new Error(`Microsoft Graph /me fetch failed: ${profileRes.status}`);
  const profile = await profileRes.json();
  const email = profile.mail ?? profile.userPrincipalName;
  if (!email) throw new Error("Microsoft account has no usable email");
  return { email: email.toLowerCase(), name: profile.displayName ?? email, provider: "microsoft" };
}

// --- Short-lived signed token carrying a verified OAuth profile ---------
//
// After the callback verifies identity with the provider, that identity
// needs to survive one redirect (to either the dashboard, on login, or the
// "name your workspace" page, on new signup) without a full session yet.
// Signed + expiring, same HMAC pattern as lib/tenant-auth.ts's session
// token — not a bearer of any privilege beyond "this email was verified
// by the provider a few minutes ago."

const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes — plenty for one redirect hop, short enough that a leaked token is low-value

function pendingSecret(): string {
  const secret = process.env.TENANT_SESSION_SECRET;
  if (!secret) throw new Error("TENANT_SESSION_SECRET is not set — required for OAuth sign-in");
  return secret;
}

export function signPendingProfile(profile: OAuthProfile): string {
  const expires = Date.now() + PENDING_TTL_MS;
  const payload = `${profile.email}.${encodeURIComponent(profile.name)}.${profile.provider}.${expires}`;
  const signature = createHmac("sha256", pendingSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function verifyPendingProfile(token: string): OAuthProfile | null {
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [email, encodedName, provider, expiresStr, signature] = parts;
  const payload = `${email}.${encodedName}.${provider}.${expiresStr}`;
  const expected = createHmac("sha256", pendingSecret()).update(payload).digest("hex");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  if (Date.now() > Number(expiresStr)) return null;
  return { email, name: decodeURIComponent(encodedName), provider: provider as OAuthProvider };
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}
