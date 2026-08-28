// GET /dashboard/sso-callback?code=...&state=<tenant slug>
// Final leg of the SSO flow: exchange Jackson's authorization code for the
// user's profile (Jackson already validated the SAML assertion by this
// point), then create OUR OWN session the same way password login does —
// SSO is an alternate way to authenticate, not a separate session system.
// See lib/tenant-auth.ts.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getJackson } from "@/lib/jackson";
import { createTenantSession } from "@/lib/tenant-auth";
import { config } from "@/lib/config";
import { captureException } from "@/lib/monitoring";
import { SiteFooter } from "@/components/SiteFooter";

export default async function SsoCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; state?: string; error?: string }>;
}) {
  const { code, state: tenantSlug, error } = await searchParams;

  if (error || !code || !tenantSlug) {
    return <ErrorScreen message="SSO login failed or was cancelled." />;
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, include: { ssoConfig: true } });
  if (!tenant?.ssoConfig?.jacksonClientId || !tenant.ssoConfig.jacksonClientSecret) {
    return <ErrorScreen message="SSO is not configured for this workspace." />;
  }

  try {
    const { oauthController } = await getJackson();

    const tokenRes = await oauthController.token({
      code,
      grant_type: "authorization_code",
      redirect_uri: `${config.appUrl}/dashboard/sso-callback`,
      client_id: tenant.ssoConfig.jacksonClientId,
      client_secret: tenant.ssoConfig.jacksonClientSecret,
    } as any); // see the `as any` note in authorize/route.ts — same discriminated-union situation

    const profile = await oauthController.userInfo(tokenRes.access_token);
    if (!profile.email) {
      return <ErrorScreen message="Your identity provider didn't return an email address." />;
    }

    // Just-in-time provisioning: first SSO login for a given email
    // auto-creates a TenantUser (as "admin", not "owner" — ownership stays
    // a deliberate, explicit action, not something SSO grants
    // automatically). Existing users just get a session.
    const user = await prisma.tenantUser.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: profile.email } },
      create: { tenantId: tenant.id, email: profile.email, role: "admin", passwordHash: null },
      update: {},
    });

    await createTenantSession(user);
  } catch (err) {
    await captureException(err, { context: "sso_callback", tenantSlug });
    return <ErrorScreen message="Something went wrong completing SSO login." />;
  }

  redirect("/dashboard");
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="card" style={{ width: 380, textAlign: "center" }}>
          <div className="topbar-brand" style={{ marginBottom: 16, justifyContent: "center" }}>Upfinity Sign</div>
          <h2>Sign-in didn't go through</h2>
          <p style={{ fontSize: 14, marginBottom: 16 }}>{message}</p>
          <a href="/dashboard/login">Back to login</a>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
