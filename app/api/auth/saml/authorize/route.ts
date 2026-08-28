// GET /api/auth/saml/authorize?workspace=<slug>
// Entry point for "Sign in with SSO" — looks up the tenant's Jackson
// connection and redirects to their IdP. See lib/jackson.ts.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getJackson, JACKSON_PRODUCT } from "@/lib/jackson";
import { config } from "@/lib/config";

export async function GET(req: NextRequest) {
  const workspace = req.nextUrl.searchParams.get("workspace");
  if (!workspace) return NextResponse.json({ error: "workspace query param is required" }, { status: 400 });

  const tenant = await prisma.tenant.findUnique({ where: { slug: workspace }, include: { ssoConfig: true } });
  if (!tenant?.ssoConfig?.enabled || !tenant.ssoConfig.jacksonClientId) {
    return NextResponse.json({ error: "SSO is not configured for this workspace" }, { status: 404 });
  }

  const { oauthController } = await getJackson();
  const result = await oauthController.authorize({
    client_id: tenant.ssoConfig.jacksonClientId,
    tenant: tenant.slug,
    product: JACKSON_PRODUCT,
    redirect_uri: `${config.appUrl}/dashboard/sso-callback`,
    response_type: "code",
    state: tenant.slug, // carried through the whole flow so the callback knows which workspace this is
  } as any); // Jackson's OAuthReq is a discriminated union across several valid request shapes — `as any` here rather than fighting TS to pick the exact matching variant; the fields above match OAuthReqBodyWithClientId per the real .d.ts

  if (result.error || !result.redirect_url) {
    return NextResponse.json({ error: result.error ?? "failed to start SSO login" }, { status: 500 });
  }

  return NextResponse.redirect(result.redirect_url);
}
