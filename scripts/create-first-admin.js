// One-time script to create the first super_admin account, since there's
// no signup flow for platform staff by design (see PRD.md §12 — platform
// admins are provisioned deliberately, not self-registered).
//
// Run with: DATABASE_URL=... node scripts/create-first-admin.js you@upfinity.ca 'a-strong-password'

const { PrismaClient } = require("@prisma/client");
const { scryptSync, randomBytes } = require("crypto");

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: node scripts/create-first-admin.js <email> <password>");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const admin = await prisma.platformAdmin.create({
    data: { email, passwordHash: hashPassword(password), role: "super_admin" },
  });
  console.log(`Created super_admin: ${admin.email}`);
  await prisma.$disconnect();
}

main();
