// Purge job for tenants that requested deletion (see
// app/api/v1/tenant/delete/route.ts) and whose grace period has passed.
// Deliberately conservative: checks each envelope's retention window
// (§6 — tiered, e.g. 7 years for enterprise) before removing it, rather
// than deleting a tenant's data wholesale the moment the grace period
// ends. Call from a daily cron (see vercel.json) — this doesn't need to
// run hourly like the reminders cron does.

import { prisma } from "../db";
import { getEffectiveTierLimits } from "../settings";
import { captureException } from "../monitoring";
import { storage } from "../storage";

const GRACE_PERIOD_DAYS = 30;

export interface PurgeResult {
  tenantId: string;
  envelopesEvaluated: number;
  envelopesPurged: number;
  envelopesRetained: number; // still within their retention window — not touched
}

/** Finds tenants past their deletion grace period and purges what's safe to purge. */
export async function runRetentionPurge(): Promise<PurgeResult[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - GRACE_PERIOD_DAYS);

  const dueTenants = await prisma.tenant.findMany({
    where: { deletionRequestedAt: { lte: cutoff } },
  });

  const results: PurgeResult[] = [];
  for (const tenant of dueTenants) {
    try {
      results.push(await purgeTenant(tenant.id));
    } catch (err) {
      await captureException(err, { context: "retention_purge", tenantId: tenant.id });
    }
  }
  return results;
}

async function purgeTenant(tenantId: string): Promise<PurgeResult> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const limits = await getEffectiveTierLimits(tenantId, tenant.tier);
  const retentionCutoff = new Date();
  retentionCutoff.setFullYear(retentionCutoff.getFullYear() - limits.retentionYears);

  const envelopes = await prisma.envelope.findMany({ where: { tenantId } });

  let purged = 0;
  let retained = 0;

  for (const envelope of envelopes) {
    if (envelope.legalHold) {
      // Never purged automatically, regardless of retention window or
      // account-deletion request — the only way this changes is someone
      // explicitly releasing the hold first (Settings → envelope detail).
      // A tenant deleting their account doesn't override this any more
      // than it overrides an unexpired retention window below.
      retained++;
      continue;
    }

    // Only ever purge envelopes whose retention window has actually
    // elapsed — a tenant asking to delete their account doesn't override
    // a document's own retention requirement (§6). completedAt is the
    // relevant clock for a signed document; createdAt covers ones that
    // never completed.
    const clock = envelope.completedAt ?? envelope.createdAt;
    if (clock > retentionCutoff) {
      retained++;
      continue;
    }

    // Delete the tenant-specific blobs before the DB row — the shared
    // Template PDF is deliberately left alone (it's reused across every
    // envelope from that template, not per-envelope). Individual blob
    // deletes can fail without aborting the whole purge — log and move on
    // rather than leaving the DB row (and everything else in this loop)
    // stuck because one delete call had a transient error.
    const certificate = await prisma.certificate.findUnique({ where: { envelopeId: envelope.id } });
    try {
      if (envelope.signedPdfStorageKey) await storage.delete(envelope.signedPdfStorageKey);
      if (certificate) await storage.delete(certificate.pdfStorageKey);
    } catch (err) {
      await captureException(err, { context: "retention_purge_blob_delete", envelopeId: envelope.id });
    }

    // Deletes cascade through recipients/auditEvents/certificate via the
    // relations already defined in schema.prisma.
    await prisma.envelope.delete({ where: { id: envelope.id } });
    purged++;
  }

  // Only fully delete the Tenant row once every envelope has cleared
  // retention — otherwise leave it suspended (already set at request
  // time) with the surviving envelopes intact.
  if (retained === 0) {
    await prisma.tenant.delete({ where: { id: tenantId } });
  }

  return { tenantId, envelopesEvaluated: envelopes.length, envelopesPurged: purged, envelopesRetained: retained };
}
