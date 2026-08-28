// Platform (super admin) authentication. Deliberately a separate session
// mechanism from both tenant API keys (lib/auth.ts) and any future
// tenant-user login — see PRD.md §12. A platform admin session should never
// be usable to authenticate as, or in place of, a tenant.

import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import type { PlatformAdmin } from "@prisma/client";

const SESSION_COOKIE = "upfinity_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

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
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not set — required for admin sessions");
  return secret;
}

function signSession(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

export async function createAdminSession(admin: PlatformAdmin) {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${admin.id}.${expires}`;
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

export async function clearAdminSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getCurrentAdmin(): Promise<PlatformAdmin | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [adminId, expiresStr, signature] = token.split(".");
  if (!adminId || !expiresStr || !signature) return null;

  const expected = signSession(`${adminId}.${expiresStr}`);
  const validSig = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!validSig) return null;

  if (Date.now() > Number(expiresStr)) return null;

  return prisma.platformAdmin.findUnique({ where: { id: adminId } });
}

export async function requireRole(roles: PlatformAdmin["role"][]): Promise<PlatformAdmin> {
  const admin = await getCurrentAdmin();
  if (!admin || !roles.includes(admin.role)) {
    throw new Error("Forbidden — insufficient platform admin role");
  }
  return admin;
}
