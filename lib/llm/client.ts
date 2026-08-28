// Upfinity Sign — LLM client.
// Default path: Vercel AI Gateway. One endpoint, one bill, zero per-token
// markup, and it already supports BYOK and Zero Data Retention natively —
// see https://vercel.com/docs/ai-gateway. Provider/model selection is
// entirely config-driven via providers.config.ts; nothing here is hardcoded
// to a specific vendor.
//
// BYOK: pass `tenantApiKey` when a tenant has supplied their own provider
// key (Phase 3 feature, PRD.md §9/§11). When present, the call bypasses the
// Gateway's shared billing and is charged to the tenant's own key instead.

import { generateText } from "ai";
import { PROVIDERS, FEATURE_DEFAULTS, type ProviderId } from "./providers.config";

export interface CompleteOptions {
  feature: keyof typeof FEATURE_DEFAULTS; // e.g. "signerSummary" — pulls its configured default
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  providerOverride?: ProviderId; // force a specific provider for this call
  tenantApiKey?: string; // BYOK — tenant's own provider key, if supplied
}

export interface CompleteResult {
  text: string;
  provider: ProviderId;
  model: string;
}

export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
  const defaults = FEATURE_DEFAULTS[opts.feature];
  const providerId = opts.providerOverride ?? defaults.provider;
  const providerCfg = PROVIDERS[providerId];
  const modelId = providerCfg.models[defaults.model] ?? providerCfg.models.default;

  if (providerId === "openrouter") {
    return callOpenRouterDirect(modelId, opts);
  }

  // Vercel AI Gateway: model id is "<provider>/<model>", auth via
  // AI_GATEWAY_API_KEY (or Vercel OIDC when deployed on Vercel — no key
  // needed at all in that case). tenantApiKey, if present, is passed through
  // for BYOK routing per Gateway's BYOK support.
  const result = await generateText({
    model: `${providerCfg.gatewayPrefix}/${modelId}`,
    system: opts.system,
    prompt: opts.prompt,
    maxOutputTokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature,
    ...(opts.tenantApiKey ? { headers: { "x-byok-key": opts.tenantApiKey } } : {}),
  });

  return { text: result.text, provider: providerId, model: modelId };
}

// Manual fallback for models not yet in the Gateway catalog, or local dev
// without a Vercel deployment/AI_GATEWAY_API_KEY configured.
async function callOpenRouterDirect(
  modelId: string,
  opts: CompleteOptions
): Promise<CompleteResult> {
  const key = opts.tenantApiKey ?? requireEnv("OPENROUTER_API_KEY");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      "HTTP-Referer": process.env.APP_URL ?? "https://upfinitysign.com",
      "X-Title": "Upfinity Sign",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        ...(opts.system ? [{ role: "system", content: opts.system }] : []),
        { role: "user", content: opts.prompt },
      ],
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature,
    }),
  });
  if (!res.ok) throw new Error(`openrouter API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content ?? "", provider: "openrouter", model: modelId };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
