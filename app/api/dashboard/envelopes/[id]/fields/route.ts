// DEPLOY TO: app/api/dashboard/envelopes/[id]/fields/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getCurrentTenantUser } from "@/lib/tenant-auth";
import { updateEnvelopeFields } from "@/lib/signing/envelopes";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentTenantUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  try {
    const updated = await updateEnvelopeFields(id, user.tenantId, body.field_map, user.email);
    return NextResponse.json({ field_map: updated.fieldMap });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't update this envelope's fields." },
      { status: 400 }
    );
  }
}
