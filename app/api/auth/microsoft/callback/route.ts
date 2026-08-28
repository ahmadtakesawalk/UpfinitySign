// DEPLOY TO: app/api/auth/microsoft/callback/route.ts

import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForProfile, signPendingProfile } from "@/lib/oauth";
import { prisma } from "@/lib/db";
import { createTenantSession } from "@/lib/tenant-auth";
import { captureException } from "@/lib/monitoring";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = req.cookies.get("oauth_state")?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/signup?error=oauth_state_mismatch", req.url));
  }

  let profile;
  try {
    profile = await exchangeCodeForProfile("microsoft", code);
  } catch (err) {
    await captureException(err, { context: "microsoft_oauth_callback" });
    return NextResponse.redirect(new URL("/signup?error=oauth_failed", req.url));
  }

  try {
    const matches = await prisma.tenantUser.findMany({ where: { email: profile.email } });

    if (matches.length === 1) {
      await createTenantSession(matches[0]);
      const res = NextResponse.redirect(new URL("/dashboard", req.url));
      res.cookies.delete("oauth_state");
      return res;
    }

    if (matches.length > 1) {
      const res = NextResponse.redirect(new URL(`/dashboard/login?email=${encodeURIComponent(profile.email)}&notice=multiple_workspaces`, req.url));
      res.cookies.delete("oauth_state");
      return res;
    }

    const pendingToken = signPendingProfile(profile);
    const res = NextResponse.redirect(new URL(`/signup/complete?token=${pendingToken}`, req.url));
    res.cookies.delete("oauth_state");
    return res;
  } catch (err) {
    await captureException(err, { context: "microsoft_oauth_callback_post_verify" });
    return NextResponse.redirect(new URL("/signup?error=oauth_failed", req.url));
  }
}
