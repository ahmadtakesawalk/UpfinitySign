// DEPLOY TO: app/api/dashboard/logout/route.ts

import { NextRequest, NextResponse } from "next/server";
import { clearTenantSession } from "@/lib/tenant-auth";

export async function POST(req: NextRequest) {
  await clearTenantSession();
  // NextResponse.redirect() defaults to 307, which strictly preserves the
  // original request method — since TopBar submits this via a native
  // <form method="POST">, the browser's follow-up request to
  // /dashboard/login would go out as POST too, but that's a page
  // component (GET-only), so it fails. 303 explicitly switches the
  // follow-up request to GET — the standard POST-form-then-redirect fix.
  // (Same bug, same fix, as app/api/admin/logout/route.ts.)
  return NextResponse.redirect(new URL("/dashboard/login", req.url), 303);
}
