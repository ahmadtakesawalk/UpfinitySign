// Prisma client singleton — prevents exhausting Neon's connection limit
// under Next.js dev hot-reload / serverless cold starts.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Encryption in transit to the database is not optional for a product
// handling signer PII and audit trails — fail fast at boot rather than
// silently running an unencrypted connection. Neon's pooled/direct
// connection strings both support `sslmode=require`; if yours doesn't
// have it, add it rather than removing this check.
const dbUrl = process.env.DATABASE_URL ?? "";
if (dbUrl && !/sslmode=require|sslmode=verify-full/.test(dbUrl)) {
  throw new Error(
    "DATABASE_URL is missing sslmode=require (or verify-full) — the database connection must be " +
      "encrypted in transit. Add ?sslmode=require to the connection string."
  );
}
