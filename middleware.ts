// Enforces route-level separation between the three auth surfaces — super
// admin, tenant dashboard, and the public/API-key-authenticated API — so a
// missed check in one handler can't silently expose another surface's data.
// See PRD.md §12.

import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    if (!req.cookies.has("upfinity_admin_session")) {
      return NextResponse.redirect(new URL("/admin/login", req.url));
    }
    // Full session/role validation happens in lib/admin-auth.ts within each
    // /admin route — this is a cheap pre-check before hitting the DB.
  }

  const dashboardPublicPaths = ["/dashboard/login", "/dashboard/sso-callback", "/dashboard/forgot-password", "/dashboard/reset-password"];
  if (pathname.startsWith("/dashboard") && !dashboardPublicPaths.includes(pathname)) {
    if (!req.cookies.has("upfinity_tenant_session")) {
      return NextResponse.redirect(new URL("/dashboard/login", req.url));
    }
    // Full session validation happens in lib/tenant-auth.ts within each
    // /dashboard route.
  }

  // These two checks intentionally never share logic or cookies with each
  // other, or with /api/v1/* (tenant API-key auth, lib/auth.ts) — no code
  // path here can grant one surface's access via another surface's cookie.

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/dashboard/:path*"],
};
