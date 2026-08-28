// DEPLOY TO: app/api/admin/logout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { clearAdminSession } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  await clearAdminSession();
  // TopBar submits this via a native <form method="POST">, so a redirect
  // response is correct — the earlier fix (plain JSON) was wrong, that
  // would've just rendered "{ ok: true }" as the page.
  //
  // The actual bug: NextResponse.redirect() defaults to a 307, which
  // strictly PRESERVES the original request method — so the browser's
  // follow-up request to /admin/login goes out as POST. But
  // /admin/login is a page component (GET-only), so that request fails.
  // Status 303 ("See Other") is the standard fix for POST-form-then-
  // redirect: it explicitly tells the browser to switch to GET.
  return NextResponse.redirect(new URL("/admin/login", req.url), 303);
}
