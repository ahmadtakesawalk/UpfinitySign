// DEPLOY TO: app/api/auth/google/route.ts

import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, generateState, isProviderConfigured } from "@/lib/oauth";

export async function GET(req: NextRequest) {
  if (!isProviderConfigured("google")) {
    return new NextResponse(
      "Google sign-in isn't configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.",
      { status: 503 }
    );
  }

  const state = generateState();
  const res = NextResponse.redirect(buildAuthUrl("google", state));
  res.cookies.set("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
