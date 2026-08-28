// DEPLOY TO: app/api/sign/[token]/verify-otp/route.ts

export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";

const MAX_ATTEMPTS = 5; // per code — a fresh code (via resend) resets this

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function hashOtp(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const accessTokenHash = hashToken(token);
  const recipient = await prisma.recipient.findUnique({ where: { accessTokenHash } });
  if (!recipient) return NextResponse.json({ error: "invalid or expired link" }, { status: 404 });
  if (recipient.otpVerifiedAt) return NextResponse.json({ ok: true });

  const { code } = await req.json();
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  if (!recipient.otpCodeHash || !recipient.otpExpiresAt) {
    return NextResponse.json({ error: "No code has been sent yet — request one first." }, { status: 400 });
  }
  if (recipient.otpExpiresAt < new Date()) {
    return NextResponse.json({ error: "That code has expired — request a new one." }, { status: 400 });
  }
  if (recipient.otpAttempts >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Too many incorrect attempts — request a new code." }, { status: 429 });
  }

  const candidate = hashOtp(code.trim());
  const storedBuf = Buffer.from(recipient.otpCodeHash, "hex");
  const candidateBuf = Buffer.from(candidate, "hex");
  const matches = storedBuf.length === candidateBuf.length && timingSafeEqual(storedBuf, candidateBuf);

  if (!matches) {
    await prisma.recipient.update({ where: { id: recipient.id }, data: { otpAttempts: { increment: 1 } } });
    const remaining = MAX_ATTEMPTS - (recipient.otpAttempts + 1);
    return NextResponse.json({ error: remaining > 0 ? `Incorrect code — ${remaining} attempt${remaining === 1 ? "" : "s"} left.` : "Too many incorrect attempts — request a new code." }, { status: 400 });
  }

  await prisma.recipient.update({ where: { id: recipient.id }, data: { otpVerifiedAt: new Date(), otpAttempts: 0 } });
  return NextResponse.json({ ok: true });
}
