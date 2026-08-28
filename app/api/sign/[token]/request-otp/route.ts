// DEPLOY TO: app/api/sign/[token]/request-otp/route.ts
// Generates and emails a fresh 6-digit code, replacing any previous one.
// Called automatically by the client on first load (see app/sign/[token]/page.tsx)
// and again if the recipient hits "Resend code" — same handler either way,
// a resend is just "generate another one."

export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { createHash, randomInt } from "crypto";
import { prisma } from "@/lib/db";
import { sendEmail, signingOtpEmail } from "@/lib/email";
import { captureException } from "@/lib/monitoring";

const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 30; // cheap abuse guard — not a full rate limiter, just stops rapid-fire resend spam

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function hashOtp(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const accessTokenHash = hashToken(token);
  const recipient = await prisma.recipient.findUnique({
    where: { accessTokenHash },
    include: { envelope: { include: { template: true } } },
  });
  if (!recipient) return NextResponse.json({ error: "invalid or expired link" }, { status: 404 });
  if (recipient.otpVerifiedAt) return NextResponse.json({ ok: true, already_verified: true });

  if (recipient.otpExpiresAt) {
    const sentAt = new Date(recipient.otpExpiresAt.getTime() - OTP_TTL_MINUTES * 60 * 1000);
    const secondsSinceSent = (Date.now() - sentAt.getTime()) / 1000;
    if (secondsSinceSent < RESEND_COOLDOWN_SECONDS) {
      return NextResponse.json({ error: `Please wait a few seconds before requesting another code.` }, { status: 429 });
    }
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await prisma.recipient.update({
    where: { id: recipient.id },
    data: { otpCodeHash: hashOtp(code), otpExpiresAt: expiresAt, otpAttempts: 0 },
  });

  try {
    await sendEmail(
      { to: recipient.email, subject: "Your verification code", html: signingOtpEmail(recipient.name, recipient.envelope.template.name, code) },
      { tenantId: recipient.envelope.tenantId }
    );
  } catch (err) {
    await captureException(err, { context: "signing_otp_send", recipientId: recipient.id });
    return NextResponse.json({ error: "Couldn't send the code — please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
