// Tenant-user session authentication for the dashboard — a fully separate
// mechanism from lib/admin-auth.ts (platform staff) and lib/auth.ts (API
// keys). See PRD §12 for why these three never share a code path.
//
// Login requires a workspace (tenant slug) + email + password, not just an
// email — the same email can legitimately belong to TenantUser rows in
// multiple tenants (someone consulting for two companies), so slug
// disambiguates which workspace they're signing into, same as Slack/Notion.

import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import type { TenantUser } from "@prisma/client";

const SESSION_COOKIE = "upfinity_tenant_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

function sessionSecret(): string {
  const secret = process.env.TENANT_SESSION_SECRET;
  if (!secret) throw new Error("TENANT_SESSION_SECRET is not set — required for tenant sessions");
  return secret;
}

function signSession(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

export async function createTenantSession(user: TenantUser) {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${user.id}.${user.tenantId}.${expires}`;
  const signature = signSession(payload);
  const token = `${payload}.${signature}`;

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    expires: new Date(expires),
    path: "/",
  });
}

export async function clearTenantSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getCurrentTenantUser(): Promise<TenantUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [userId, tenantId, expiresStr, signature] = token.split(".");
  if (!userId || !tenantId || !expiresStr || !signature) return null;

  const expected = signSession(`${userId}.${tenantId}.${expiresStr}`);
  const validSig = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!validSig) return null;
  if (Date.now() > Number(expiresStr)) return null;

  const user = await prisma.tenantUser.findUnique({ where: { id: userId } });
  // Re-check tenantId matches — defense in depth if a row were ever moved
  // between tenants (shouldn't happen, but the check is cheap).
  if (!user || user.tenantId !== tenantId) return null;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.suspended) return null; // suspended tenants can't use the dashboard either

  return user;
}

export function requireTenantRole(user: TenantUser, roles: TenantUser["role"][]): boolean {
  return roles.includes(user.role);
}
