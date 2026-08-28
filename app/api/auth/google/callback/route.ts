// DEPLOY TO: app/api/auth/google/callback/route.ts

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
    profile = await exchangeCodeForProfile("google", code);
  } catch (err) {
    await captureException(err, { context: "google_oauth_callback" });
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
      // Same email registered under more than one workspace — same
      // ambiguity password login handles by asking for a workspace slug.
      // Not building a separate workspace-picker UI for this edge case;
      // send them to the regular login page where that disambiguation
      // already exists.
      const res = NextResponse.redirect(new URL(`/dashboard/login?email=${encodeURIComponent(profile.email)}&notice=multiple_workspaces`, req.url));
      res.cookies.delete("oauth_state");
      return res;
    }

    // No existing account — verified identity, but we don't have a company
    // name from Google. Hand off to a short "name your workspace" step via
    // a signed, short-lived token, not a full session (nothing exists yet
    // to have a session for).
    const pendingToken = signPendingProfile(profile);
    const res = NextResponse.redirect(new URL(`/signup/complete?token=${pendingToken}`, req.url));
    res.cookies.delete("oauth_state");
    return res;
  } catch (err) {
    // Identity was already verified above at this point — a failure here
    // is a database/infra issue, not the person's fault. Without this
    // catch, they'd see a raw Next.js error page instead of a clean
    // redirect back to signup with something actionable.
    await captureException(err, { context: "google_oauth_callback_post_verify" });
    return NextResponse.redirect(new URL("/signup?error=oauth_failed", req.url));
  }
}
