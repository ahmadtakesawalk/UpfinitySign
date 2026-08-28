// Creates a real Jackson SAML connection from the IdP metadata a tenant
// admin pastes in — this is what actually enables SSO, not just storage.
// See lib/jackson.ts for what's verified vs not.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { getJackson, JACKSON_PRODUCT } from "@/lib/jackson";
import { config } from "@/lib/config";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(user, ["owner", "admin"])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  const formData = await req.formData();
  const rawMetadata = formData.get("rawMetadata") as string; // the tenant pastes their IdP's metadata XML directly

  if (!rawMetadata?.trim()) {
    return NextResponse.json({ error: "IdP metadata XML is required" }, { status: 400 });
  }

  try {
    const { apiController } = await getJackson();
    const connection = await apiController.createSAMLConnection({
      tenant: tenant.slug, // our Tenant maps 1:1 to Jackson's "tenant" concept
      product: JACKSON_PRODUCT,
      rawMetadata,
      defaultRedirectUrl: `${config.appUrl}/dashboard/sso-callback`,
      redirectUrl: [`${config.appUrl}/dashboard/sso-callback`],
      name: `${tenant.name} SSO`,
    });

    await prisma.ssoConfig.upsert({
      where: { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        provider: "saml",
        jacksonClientId: connection.clientID,
        jacksonClientSecret: connection.clientSecret,
        idpEntityId: connection.idpMetadata?.entityID,
        enabled: true, // connection creation succeeded — Jackson validated the metadata itself
      },
      update: {
        jacksonClientId: connection.clientID,
        jacksonClientSecret: connection.clientSecret,
        idpEntityId: connection.idpMetadata?.entityID,
        enabled: true,
      },
    });
  } catch (err) {
    await captureException(err, { context: "sso_connection_create", tenantId: tenant.id });
    return NextResponse.json(
      { error: "Failed to create SSO connection — check the metadata XML is valid and try again" },
      { status: 400 }
    );
  }

  return NextResponse.redirect(new URL("/dashboard/settings", req.url), 303);
}
