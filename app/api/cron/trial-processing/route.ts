// DEPLOY TO: app/api/cron/trial-processing/route.ts
// Vercel Cron target — daily, same auth pattern as reminders/retention-purge.

import { NextRequest, NextResponse } from "next/server";
import { processTrialExpirations } from "@/lib/billing/trial";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await processTrialExpirations();
  return NextResponse.json(result);
}
