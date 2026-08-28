// Certificate loading for PDF PKI signing. Which cert is used is entirely
// determined by config.signing.certMode (see lib/config.ts + PRD.md §7) —
// callers never branch on this themselves, they just call getSigningCert().

import forge from "node-forge";
import { config } from "../config";

export interface SigningCert {
  privateKeyPem: string;
  certificatePem: string;
  mode: "self-signed" | "digicert";
}

let cached: SigningCert | null = null;

export async function getSigningCert(): Promise<SigningCert> {
  if (cached) return cached;

  cached =
    config.signing.certMode === "digicert"
      ? await loadDigicertCert()
      : await getOrCreateSelfSignedCert();

  return cached;
}

/**
 * Generates (once) or loads a self-signed cert for dev/pre-launch use.
 * Cryptographically identical tamper-evidence to a CA-issued cert — the
 * only difference is PDF readers show "signature validity unknown" instead
 * of a trusted green checkmark until this is swapped for a real one.
 * See PRD.md §7 for when to make that swap.
 */
async function getOrCreateSelfSignedCert(): Promise<SigningCert> {
  const existingKey = process.env.SELF_SIGNED_PRIVATE_KEY_PEM;
  const existingCert = process.env.SELF_SIGNED_CERT_PEM;
  if (existingKey && existingCert) {
    return { privateKeyPem: existingKey, certificatePem: existingCert, mode: "self-signed" };
  }

  // Generate on the fly (dev convenience only — in any persistent
  // environment, run scripts/generate-self-signed-cert.js ONCE and pin the
  // output into SELF_SIGNED_PRIVATE_KEY_PEM / _CERT_PEM so the same
  // identity signs every document, not a new one per cold start).
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    { name: "commonName", value: "Upfinity Sign (self-signed, dev)" },
    { name: "organizationName", value: "Upfinity Inc." },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificatePem: forge.pki.certificateToPem(cert),
    mode: "self-signed",
  };
}

/**
 * DigiCert Document Signing Manager cert, pulled from cloud KMS (see
 * lib/config.ts signing.kmsKeyId). Not wired to a live KMS SDK here since
 * the actual provider (AWS/GCP/Azure KMS) is chosen at purchase time —
 * fill in the marked section once that decision is made (PRD.md §7).
 */
async function loadDigicertCert(): Promise<SigningCert> {
  if (!config.signing.kmsKeyId) {
    throw new Error(
      "SIGNING_CERT_MODE=digicert but SIGNING_KEY_KMS_ID is not set. " +
        "Purchase a DigiCert Document Signing cert and configure cloud KMS before switching modes."
    );
  }
  // TODO once DigiCert cert is purchased: fetch the cert chain from your
  // KMS provider's SDK here (aws-sdk KMS, @google-cloud/kms, or
  // @azure/keyvault-certificates), returning the same SigningCert shape.
  throw new Error("DigiCert cert loading not yet implemented — see TODO in lib/signing/cert.ts");
}
