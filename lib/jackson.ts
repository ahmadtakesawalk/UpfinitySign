// SAML via BoxyHQ's Jackson library (recently renamed upstream to Ory
// Polis — same package, @boxyhq/saml-jackson still works). This is the
// library doing the actual XML signature validation — our own code never
// touches raw SAML XML, only Jackson's OAuth2-shaped API. See PRD §12 for
// why that matters.
//
// Verified against @boxyhq/saml-jackson's actual shipped .d.ts files
// (installed and inspected directly) rather than assumed from memory — the
// method names and shapes below are confirmed real. What's still
// unverified is a live end-to-end run against a real IdP, since this
// environment has no path to one — see PRD §14 for that distinction.
//
// No account or signup required anywhere in this file — Jackson is
// MIT-licensed and self-hosted here by pointing it at our own Neon DB.

import controllers, { type SAMLJackson } from "@boxyhq/saml-jackson";
import { config } from "./config";

let jacksonPromise: Promise<SAMLJackson> | null = null;

export function getJackson(): Promise<SAMLJackson> {
  if (!jacksonPromise) {
    jacksonPromise = controllers({
      externalUrl: config.appUrl,
      samlPath: "/api/auth/saml/callback", // Jackson's ACS endpoint — the IdP POSTs here after the user authenticates
      samlAudience: `${config.appUrl}`,
      db: {
        engine: "sql",
        type: "postgres",
        url: requireEnv("DATABASE_URL"), // same Neon instance as the rest of the app — Jackson manages its own tables within it
      },
    });
  }
  return jacksonPromise;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// Every tenant gets the same Jackson "product" — Jackson's tenant/product
// pair is how it looks up which IdP connection to use; we map OUR Tenant
// to Jackson's "tenant" 1:1 and use a single fixed product since we don't
// have Jackson's own multi-product concept.
export const JACKSON_PRODUCT = "upfinity-sign";
