import { NextRequest, NextResponse } from "next/server";
import { runRetentionPurge } from "@/lib/billing/retention-purge";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results = await runRetentionPurge();
  return NextResponse.json({ tenants_processed: results.length, results });
}
