// DEPLOY TO: lib/signing/contacts.ts
//
// A tenant's own address book — auto-populated from recipients used on
// envelopes (see the call sites in lib/signing/envelopes.ts), and read
// back to power a "choose from contacts" picker on future envelopes
// instead of retyping name+email every time.

import { prisma } from "../db";

/**
 * Called once per recipient at send/draft-save time — creates the contact
 * if it's new, or just bumps lastUsedAt (and refreshes the name, in case
 * it changed) if it already exists. Never fails the actual envelope
 * operation it's called from if this itself has a problem — a contact
 * failing to save is not a reason to block sending a document.
 */
export async function upsertContact(tenantId: string, name: string, email: string): Promise<void> {
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !name.trim()) return;
  try {
    await prisma.contact.upsert({
      where: { tenantId_email: { tenantId, email: trimmedEmail } },
      create: { tenantId, name: name.trim(), email: trimmedEmail },
      update: { name: name.trim(), lastUsedAt: new Date() },
    });
  } catch {
    // Best-effort — see doc comment above.
  }
}

export async function upsertContacts(tenantId: string, recipients: { name: string; email: string }[]): Promise<void> {
  await Promise.all(recipients.map((r) => upsertContact(tenantId, r.name, r.email)));
}

export async function listContacts(tenantId: string, query?: string) {
  return prisma.contact.findMany({
    where: {
      tenantId,
      ...(query
        ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }] }
        : {}),
    },
    orderBy: { lastUsedAt: "desc" },
    take: 50,
  });
}
