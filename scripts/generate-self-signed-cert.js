// One-time script: generates a persistent self-signed signing identity and
// prints the PEM values to pin into SELF_SIGNED_PRIVATE_KEY_PEM /
// SELF_SIGNED_CERT_PEM (in .env.local for dev, and in Vercel's Environment
// Variables for deployed environments). Run this ONCE per environment —
// re-running it rotates your signing identity, which you don't want once
// documents have been signed under it.
//
// Run with: node scripts/generate-self-signed-cert.js
// (kept as plain JS, not TS, so it runs with zero build step)

const forge = require("node-forge");

const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = "01";
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

const attrs = [
  { name: "commonName", value: "Upfinity Sign (self-signed, pre-launch)" },
  { name: "organizationName", value: "Upfinity Inc." },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.sign(keys.privateKey, forge.md.sha256.create());

const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
const certificatePem = forge.pki.certificateToPem(cert);

console.log("\n--- Add these to your env vars (.env.local locally, Vercel project settings when deployed) ---\n");
console.log("SELF_SIGNED_PRIVATE_KEY_PEM=" + JSON.stringify(privateKeyPem));
console.log("\nSELF_SIGNED_CERT_PEM=" + JSON.stringify(certificatePem));
console.log(
  "\n--- Valid for 1 year (expires " +
    cert.validity.notAfter.toISOString().slice(0, 10) +
    "). Regenerate before then, or swap to a DigiCert cert per PRD.md §7 before it matters. ---\n"
);
