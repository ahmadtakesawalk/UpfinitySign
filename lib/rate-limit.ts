// Fixed-window rate limiting, backed by RateLimitBucket rather than an
// in-process Map — Vercel serverless functions don't share memory across
// instances, so an in-memory counter would under-count and let a bad
// integration through. Limits are per tenant, per minute, config-driven
// (not hardcoded) — see config.rateLimit.

import { prisma } from "./db";
import { config } from "./config";

export class RateLimitExceededError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Rate limit exceeded — retry after ${retryAfterSeconds}s`);
  }
}

function currentWindow(): Date {
  const now = new Date();
  now.setSeconds(0, 0);
  return now;
}

/** Throws RateLimitExceededError if this tenant has exceeded config.rateLimit.requestsPerMinute in the current minute window. Call at the top of any public API route. */
export async function assertWithinRateLimit(tenantId: string) {
  const windowStart = currentWindow();

  const bucket = await prisma.rateLimitBucket.upsert({
    where: { tenantId_windowStart: { tenantId, windowStart } },
    create: { tenantId, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });

  if (bucket.count > config.rateLimit.requestsPerMinute) {
    const secondsIntoWindow = (Date.now() - windowStart.getTime()) / 1000;
    throw new RateLimitExceededError(Math.ceil(60 - secondsIntoWindow));
  }
}

/**
 * Login-attempt throttling — separate from assertWithinRateLimit above
 * because there's no tenantId yet at login time. Reuses the same
 * RateLimitBucket table with a synthetic key (`login:<ip>` or
 * `login:<ip>:<email>`) rather than a new table, and a much tighter limit
 * than the general API — brute-forcing a password is exactly what this
 * needs to stop, and 120 req/min (the API default) is far too loose for that.
 */
export async function assertWithinLoginRateLimit(key: string) {
  const windowStart = currentWindow();
  const bucketKey = `login:${key}`;

  const bucket = await prisma.rateLimitBucket.upsert({
    where: { tenantId_windowStart: { tenantId: bucketKey, windowStart } },
    create: { tenantId: bucketKey, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });

  if (bucket.count > config.rateLimit.loginAttemptsPerMinute) {
    const secondsIntoWindow = (Date.now() - windowStart.getTime()) / 1000;
    throw new RateLimitExceededError(Math.ceil(60 - secondsIntoWindow));
  }
}

/**
 * Old buckets accumulate forever otherwise. Call from the reminders cron
 * (already runs hourly) rather than adding a second cron just for this.
 */
export async function pruneOldRateLimitBuckets() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000); // keep 1 hour of history for debugging
  const { count } = await prisma.rateLimitBucket.deleteMany({
    where: { windowStart: { lt: cutoff } },
  });
  return count;
}
