// RFC 3161 timestamping. Without this, a signature's provable validity is
// limited to the signing cert's lifetime (1 year for the self-signed cert —
// see cert.ts). A trusted timestamp proves the signature existed at a
// specific time, so verification keeps working after the cert expires.
// See PRD.md §5.
//
// HONESTY NOTE, same spirit as the SSO scaffold in lib/tenant settings:
// this hand-builds the RFC 3161 TimeStampReq/Resp ASN.1 structures with
// node-forge rather than a dedicated TSP library, because I don't have
// enough confidence in an untested library choice to recommend one blind.
// The request-building half (buildTimeStampRequest) is mechanical DER
// construction and reasonably safe. The response-parsing half
// (extractTimeStampToken) is exactly the kind of code that looks right and
// silently breaks against a real server's actual byte layout — this
// sandbox's network allowlist doesn't include any TSA endpoint (see the
// filesystem/network config), so NONE of this has been run against a real
// TSA response. Test this against config.signing.timestampAuthorityUrl
// with real network access before trusting it in the signing pipeline —
// don't wire it into finalizePdf() until that verification pass happens.

import forge from "node-forge";
import { config } from "../config";

const OID_SHA256 = "2.16.840.1.101.3.4.2.1";

/** Builds a DER-encoded RFC 3161 TimeStampReq over the SHA-256 digest of the signed content. */
export function buildTimeStampRequest(messageDigestSha256: Buffer): Buffer {
  const messageImprint = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OID,
        false,
        forge.asn1.oidToDer(OID_SHA256).getBytes()
      ),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ""),
    ]),
    forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.OCTETSTRING,
      false,
      messageDigestSha256.toString("binary")
    ),
  ]);

  const nonceBytes = forge.random.getBytesSync(8);

  const request = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, "\x01"), // version 1
    messageImprint,
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, nonceBytes),
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.BOOLEAN, false, "\xff"), // certReq: true
  ]);

  return Buffer.from(forge.asn1.toDer(request).getBytes(), "binary");
}

/** POSTs a TimeStampReq to the configured TSA. Returns the raw DER TimeStampResp. UNVERIFIED — see file header. */
export async function requestTimestamp(messageDigestSha256: Buffer): Promise<Buffer> {
  const query = buildTimeStampRequest(messageDigestSha256);

  const res = await fetch(config.signing.timestampAuthorityUrl, {
    method: "POST",
    headers: { "content-type": "application/timestamp-query" },
    // fetch's BodyInit type doesn't structurally accept a Node Buffer in
    // newer TypeScript/@types/node — Buffer IS correct at runtime (it's
    // exactly the raw bytes a TSA POST body needs), this is a types-only
    // mismatch. Uint8Array.from() gives a plain Uint8Array, which every
    // version of the BodyInit type accepts.
    body: Uint8Array.from(query),
  });

  if (!res.ok) {
    throw new Error(`Timestamp authority returned ${res.status}: ${await res.text()}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Parses a TimeStampResp, returning the embedded TimeStampToken (a CMS
 * ContentInfo) to embed as an unauthenticated attribute in the document
 * signature's SignedData. Throws if the TSA rejected the request.
 * UNVERIFIED against a real TSA response — see file header.
 */
export function extractTimeStampToken(responseDer: Buffer): Buffer {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(responseDer.toString("binary")));
  const seq = asn1.value as forge.asn1.Asn1[];

  // TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken TimeStampToken OPTIONAL }
  // PKIStatusInfo ::= SEQUENCE { status PKIStatus (INTEGER), statusString ... OPTIONAL, failInfo ... OPTIONAL }
  const statusInfo = seq[0].value as forge.asn1.Asn1[];
  const statusInt = statusInfo[0];
  const statusByte = (statusInt.value as string).charCodeAt(0);

  // PKIStatus: 0 granted, 1 grantedWithMods — both usable. Anything else, treat as failure.
  if (statusByte > 1 || seq.length < 2) {
    throw new Error(`TSA rejected the timestamp request (PKIStatus=${statusByte})`);
  }

  return Buffer.from(forge.asn1.toDer(seq[1]).getBytes(), "binary");
}
