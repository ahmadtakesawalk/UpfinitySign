// DEPLOY TO: app/api/dashboard/contacts/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { listContacts } from "@/lib/signing/contacts";

export async function GET(req: NextRequest) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const query = req.nextUrl.searchParams.get("q") ?? undefined;
  const contacts = await listContacts(user.tenantId, query);

  return NextResponse.json({
    contacts: contacts.map((c: (typeof contacts)[number]) => ({ id: c.id, name: c.name, email: c.email })),
  });
}
