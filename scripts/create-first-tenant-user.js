// Creates a tenant (if it doesn't exist) plus its first owner TenantUser
// with a real password — the missing piece that made DEV_DASHBOARD_TENANT_ID
// necessary before real login existed.
//
// Run with: node scripts/create-first-tenant-user.js <slug> <name> <email> <password>
// Example:  node scripts/create-first-tenant-user.js dvxel "Dvxel Qbank" admin@dvxel.com 'a-strong-password'

const { PrismaClient } = require("@prisma/client");
const { scryptSync, randomBytes } = require("crypto");

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const [slug, name, email, password] = process.argv.slice(2);
  if (!slug || !name || !email || !password) {
    console.error("Usage: node scripts/create-first-tenant-user.js <slug> <name> <email> <password>");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: { slug, name },
    update: {},
  });

  const user = await prisma.tenantUser.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    create: { tenantId: tenant.id, email, passwordHash: hashPassword(password), role: "owner" },
    update: { passwordHash: hashPassword(password), role: "owner" },
  });

  console.log(`Tenant "${tenant.name}" (slug: ${tenant.slug}) — owner: ${user.email}`);
  console.log(`Log in at /dashboard/login with workspace="${slug}"`);
  await prisma.$disconnect();
}

main();
