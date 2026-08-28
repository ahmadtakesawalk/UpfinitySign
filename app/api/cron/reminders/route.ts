// Vercel Cron target — see vercel.json for schedule. Handles both hard
// expiry and the 48hr reminder nudge (PRD.md §13, Phase 1 items 7/9).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { expireOverdueEnvelopes, isRecipientUnlocked, sendReminderEmail } from "@/lib/signing/envelopes";
import { logAuditEvent } from "@/lib/signing/audit";
import { pruneOldRateLimitBuckets } from "@/lib/rate-limit";
import { captureException } from "@/lib/monitoring";

export async function GET(req: NextRequest) {
  // Vercel Cron requests carry this header — reject anything else so the
  // endpoint can't be triggered by an outside party.
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const expiredCount = await expireOverdueEnvelopes();
  const reminderCount = await sendDueReminders();
  const prunedBuckets = await pruneOldRateLimitBuckets();

  return NextResponse.json({ expired: expiredCount, reminders_sent: reminderCount, pruned_rate_limit_buckets: prunedBuckets });
}

async function sendDueReminders() {
  const now = new Date();

  // Can't filter by a single createdAt cutoff in the query anymore — each
  // envelope may have its own reminder cadence — so pull every envelope
  // still awaiting action and check each one's own cutoff in-process.
  // Reminder-eligible envelopes are a small slice of total volume at any
  // realistic scale here, so this stays cheap.
  const candidates = await prisma.envelope.findMany({
    where: { status: { in: ["sent", "delivered"] } },
    include: {
      template: true,
      recipients: { where: { status: { in: ["pending", "delivered"] } } },
    },
  });

  const due = candidates.filter((envelope) => {
    const hours = envelope.reminderAfterHoursOverride ?? config.envelopes.reminderAfterHours;
    const cutoff = new Date(envelope.createdAt);
    cutoff.setHours(cutoff.getHours() + hours);
    return cutoff <= now;
  });

  let count = 0;
  for (const envelope of due) {
    for (const recipient of envelope.recipients) {
      if (recipient.role === "cc") continue; // already notified once at send time — nothing pending for them to be reminded about
      const gate = await isRecipientUnlocked(recipient.id);
      if (!gate.unlocked) continue; // still waiting on someone earlier in the order — a reminder would be misleading

      // Repeat on the same cadence, not every cron tick — without this,
      // a recipient who stays pending past the cutoff would get a fresh
      // reminder every single hourly run forever (this was a real bug:
      // nothing previously recorded when the LAST reminder went out, only
      // whether the envelope itself was old enough).
      const lastReminder = await prisma.auditEvent.findFirst({
        where: { recipientId: recipient.id, eventType: "reminder_sent" },
        orderBy: { timestamp: "desc" },
      });
      const hours = envelope.reminderAfterHoursOverride ?? config.envelopes.reminderAfterHours;
      const nextDue = new Date(lastReminder?.timestamp ?? envelope.createdAt);
      nextDue.setHours(nextDue.getHours() + hours);
      if (nextDue > now) continue;

      try {
        const result = await sendReminderEmail(envelope, recipient, false);
        if (result.sent) count++;
      } catch (err) {
        await captureException(err, { context: "reminder_send", envelopeId: envelope.id, recipientId: recipient.id });
      }
    }
  }
  return count;
}
