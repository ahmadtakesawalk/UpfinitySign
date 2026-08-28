// Tenant authentication for the server-to-server API (§4 of PRD — Dvxel
// Qbank and any future tenant integration authenticate this way).
// Never trust a tenant_id from the request body — it always comes from the
// authenticated key, here.

import { createHash, timingSafeEqual, randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "./db";
import type { Tenant } from "@prisma/client";

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export interface AuthenticatedTenant {
  tenant: Tenant;
  apiKeyId: string;
  scopes: string[];
}

export async function authenticateTenant(req: NextRequest): Promise<AuthenticatedTenant | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const rawKey = authHeader.slice("Bearer ".length).trim();
  if (!rawKey) return null;

  const keyHash = hashApiKey(rawKey);
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { tenant: true },
  });

  if (!apiKey || apiKey.revokedAt) return null;
  if (apiKey.tenant.suspended) return null; // super admin kill switch — see PlatformAdmin flows

  const match = timingSafeEqual(Buffer.from(apiKey.keyHash), Buffer.from(keyHash));
  if (!match) return null;

  // Fire-and-forget — don't block the request on this write.
  prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return { tenant: apiKey.tenant, apiKeyId: apiKey.id, scopes: apiKey.scopes as string[] };
}

/** Generates a new raw API key + its hash. Show the raw key to the tenant ONCE at creation time — only the hash is stored. */
export function generateApiKey(): { rawKey: string; hash: string } {
  const rawKey = "usk_" + randomBytes(24).toString("hex");
  return { rawKey, hash: hashApiKey(rawKey) };
}

export function requireScope(auth: AuthenticatedTenant, scope: string): boolean {
  return auth.scopes.includes(scope);
}
