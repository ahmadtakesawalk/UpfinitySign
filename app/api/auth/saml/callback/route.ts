// POST /api/auth/saml/callback — the IdP posts the SAMLResponse here after
// the user authenticates. This is the Assertion Consumer Service (ACS)
// URL registered with the IdP. Jackson validates the signed XML assertion
// internally — this route never parses SAML XML itself.

import { NextRequest, NextResponse } from "next/server";
import { getJackson } from "@/lib/jackson";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const SAMLResponse = formData.get("SAMLResponse") as string;
  const RelayState = (formData.get("RelayState") as string) ?? "";

  if (!SAMLResponse) {
    return NextResponse.json({ error: "missing SAMLResponse" }, { status: 400 });
  }

  const { oauthController } = await getJackson();
  const result = await oauthController.samlResponse({ SAMLResponse, RelayState });

  if (result.error || !result.redirect_url) {
    return NextResponse.json({ error: result.error ?? "SSO login failed" }, { status: 400 });
  }

  return NextResponse.redirect(result.redirect_url);
}
