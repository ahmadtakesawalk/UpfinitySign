// GET /api/health — for external uptime monitoring (UptimeRobot, Better
// Uptime, or Vercel's own monitoring) to poll. Checks the one dependency
// that actually matters for "is the app usable": the database.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: String(err), timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
