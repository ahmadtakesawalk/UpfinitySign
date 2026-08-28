// Logs every action a platform admin takes — separate from AuditEvent
// (which tracks what happens to a signer's envelope). This is "who on our
// staff touched what, and when" — table stakes for enterprise security review.

import { prisma } from "./db";
import type { PlatformAdmin } from "@prisma/client";

export async function logAdminAction(
  admin: PlatformAdmin,
  action: string,
  targetTenantId?: string,
  details?: Record<string, unknown>,
  ipAddress?: string
) {
  return prisma.adminAuditLog.create({
    data: {
      platformAdminId: admin.id,
      action,
      targetTenantId,
      details: details as any,
      ipAddress,
    },
  });
}
