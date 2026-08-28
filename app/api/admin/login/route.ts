import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createAdminSession } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";
import { assertWithinLoginRateLimit, RateLimitExceededError } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // Tighter than tenant login on purpose — a compromised platform-admin
  // account is a full cross-tenant breach, not just one workspace.
  try {
    await assertWithinLoginRateLimit(`admin:${ip}:${email}`);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json(
        { error: "Too many attempts — try again shortly." },
        { status: 429, headers: { "retry-after": String(err.retryAfterSeconds) } }
      );
    }
    throw err;
  }

  const admin = await prisma.platformAdmin.findUnique({ where: { email } });
  // Constant-shape response whether the email exists, has no password set
  // yet (invited but hasn't finished setup), or the password is wrong —
  // don't leak which emails are registered platform admins or their setup
  // state. A null passwordHash would otherwise throw inside verifyPassword
  // (it expects a "salt:hash" string) rather than just failing the login.
  if (!admin || !admin.passwordHash || !verifyPassword(password, admin.passwordHash)) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  await createAdminSession(admin);
  await logAdminAction(admin, "admin.login", undefined, undefined, ip);

  return NextResponse.json({ ok: true });
}
