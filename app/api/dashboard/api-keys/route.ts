// POST /api/dashboard/api-keys — the missing piece that makes the whole
// "tenant ID/secret to send envelopes" integration story actually usable
// self-serve, instead of requiring prisma studio. See PRD §4/§11.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenantUser, requireTenantRole } from "@/lib/tenant-auth";
import { generateApiKey } from "@/lib/auth";
import { captureException } from "@/lib/monitoring";

const VALID_SCOPES = ["envelopes:write", "envelopes:read"];

export async function POST(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requireTenantRole(user, ["owner", "admin"])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { name, scopes } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: "a name for the key is required" }, { status: 400 });

    const requestedScopes = Array.isArray(scopes) && scopes.length ? scopes : VALID_SCOPES;
    const invalidScope = requestedScopes.find((s: string) => !VALID_SCOPES.includes(s));
    if (invalidScope) return NextResponse.json({ error: `unknown scope: ${invalidScope}` }, { status: 400 });

    const { rawKey, hash } = generateApiKey();

    const apiKey = await prisma.apiKey.create({
      data: { tenantId: user.tenantId, name: name.trim(), keyHash: hash, scopes: requestedScopes as any },
    });

    // This is the ONLY response that will ever contain the raw key — it's
    // never retrievable again after this, by design (matches how every major
    // provider handles API keys). The client must show/copy it immediately.
    return NextResponse.json({
      id: apiKey.id,
      name: apiKey.name,
      scopes: apiKey.scopes,
      raw_key: rawKey,
    });
  } catch (err) {
    await captureException(err, { context: "api_key_create", tenantId: user.tenantId });
    return NextResponse.json({ error: "Something went wrong creating this key. Please try again." }, { status: 500 });
  }
}
