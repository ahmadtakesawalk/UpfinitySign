// Monitoring hooks. Honest about what's real: this gives you structured,
// consistent logging and a single captureException() call site everywhere
// an error matters — but it does NOT page anyone until you set SENTRY_DSN
// (or swap in another provider here). Without that, "monitoring" is really
// just "readable logs in Vercel's dashboard", which is a real but limited
// step up from scattered console.error calls. See PRD §14.

import { config } from "./config";

export function logEvent(event: string, data?: Record<string, unknown>) {
  // Structured JSON logs are what Vercel's log drains / any log aggregator
  // actually want — plain strings are harder to query later.
  console.log(JSON.stringify({ event, ...data, timestamp: new Date().toISOString() }));
}

export async function captureException(error: unknown, context?: Record<string, unknown>) {
  console.error(JSON.stringify({ error: String(error), ...context, timestamp: new Date().toISOString() }));

  if (!config.monitoring.sentryDsn) return; // no-op until a DSN is configured — see .env.example

  try {
    // Dynamic import so @sentry/nextjs isn't a hard dependency if unused —
    // add it to package.json when you actually set SENTRY_DSN.
    //
    // The module specifier is built as a variable rather than a string
    // literal on purpose: TypeScript resolves and type-checks a literal
    // import("@sentry/nextjs") at COMPILE time regardless of the runtime
    // try/catch around it — so with the package genuinely absent (the
    // whole point of this being optional), the build fails outright
    // instead of just no-op'ing at runtime like the try/catch intends.
    // A variable specifier can't be statically resolved, so TS treats it
    // as `any` and skips that check — this is what actually makes it
    // optional at both compile time and runtime, not just runtime.
    const sentryModuleSpecifier = "@sentry/nextjs";
    const Sentry = await import(sentryModuleSpecifier);
    Sentry.captureException(error, { extra: context });
  } catch {
    // Sentry package not installed yet — logged above regardless, don't
    // throw a secondary error over a missing optional dependency.
  }
}
