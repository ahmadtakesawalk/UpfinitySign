import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createTenantSession } from "@/lib/tenant-auth";
import { assertWithinLoginRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { captureException } from "@/lib/monitoring";

export async function POST(req: NextRequest) {
  try {
    const { workspace, email, password } = await req.json();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

    try {
      await assertWithinLoginRateLimit(`${ip}:${workspace}:${email}`);
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        return NextResponse.json(
          { error: "Too many attempts — try again shortly." },
          { status: 429, headers: { "retry-after": String(err.retryAfterSeconds) } }
        );
      }
      throw err;
    }

    const tenant = await prisma.tenant.findUnique({ where: { slug: workspace } });
    if (!tenant || tenant.suspended) {
      return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
    }

    const user = await prisma.tenantUser.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
    });

    // Constant response shape whether the workspace/email/password is wrong —
    // don't leak which part failed.
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
    }

    await createTenantSession(user);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Same reasoning as signup's outer catch: without this, any
    // unexpected failure (a database hiccup, a schema not fully synced)
    // escaped uncaught and the client got an empty response body instead
    // of a real error — "Unexpected end of JSON input" on their end, not
    // a login failure message. Every path through this route now
    // guarantees real JSON back to the client.
    await captureException(err, { context: "login" });
    return NextResponse.json({ error: "Something went wrong signing you in. Please try again." }, { status: 500 });
  }
}
