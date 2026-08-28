// DEPLOY TO: app/api/public/self-serve/[token]/route.ts
//
// No session, no API key — this is a deliberately public endpoint (that's
// the whole point of a self-serve link). Rate-limited per-tenant to keep
// it from being abused as a free envelope-creation firehose against a
// tenant's monthly cap; createEnvelope()'s own tier-limit check is the
// real backstop.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createEnvelope } from "@/lib/signing/envelopes";
import { assertWithinRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { TierLimitExceededError } from "@/lib/billing/metering";
import { TrialCardRequiredError } from "@/lib/billing/trial";
import { decryptToken } from "@/lib/token-crypto";
import { captureException } from "@/lib/monitoring";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const template = await prisma.template.findUnique({ where: { selfServeToken: token } });
  if (!template || !template.selfServeEnabled) {
    return NextResponse.json({ error: "This signing link isn't available." }, { status: 404 });
  }
  return NextResponse.json({ template_name: template.name });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const template = await prisma.template.findUnique({ where: { selfServeToken: token } });
  if (!template || !template.selfServeEnabled) {
    return NextResponse.json({ error: "This signing link isn't available." }, { status: 404 });
  }

  try {
    await assertWithinRateLimit(template.tenantId);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: "Too many requests — try again shortly." }, { status: 429 });
    }
    throw err;
  }

  const { name, email } = await req.json();
  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "Name and email are required." }, { status: 400 });
  }

  try {
    const envelope = await createEnvelope(template.tenantId, {
      templateId: template.id,
      externalRef: "self-serve",
      recipients: [{ name: name.trim(), email: email.trim(), role: "signer", signingOrder: 1 }],
    });

    // createEnvelope only returns the recipient rows with hashed tokens —
    // fetch the one recipient we just made and recover its raw token the
    // same way reminders/in-person-signing do, so we can send this
    // visitor straight into their own signing flow instead of making them
    // go check email first.
    const recipient = await prisma.recipient.findFirstOrThrow({ where: { envelopeId: envelope.id } });
    if (!recipient.accessTokenEncrypted) throw new Error("Missing accessTokenEncrypted on freshly created recipient");
    const rawToken = decryptToken(recipient.accessTokenEncrypted);

    return NextResponse.json({ sign_token: rawToken });
  } catch (err) {
    if (err instanceof TierLimitExceededError) {
      return NextResponse.json({ error: "This workspace has reached its monthly envelope limit — try again next month." }, { status: 429 });
    }
    if (err instanceof TrialCardRequiredError) {
      return NextResponse.json({ error: "This document isn't available right now — please contact the sender." }, { status: 402 });
    }
    await captureException(err, { context: "self_serve_envelope_create", templateId: template.id });
    return NextResponse.json({ error: "Something went wrong — try again." }, { status: 500 });
  }
}
