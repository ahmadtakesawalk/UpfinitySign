// Upfinity Sign — AI provider registry.
// This is the ONE file to edit to add, remove, or re-default a provider.
// No other code should hardcode a provider or model id — everything reads
// from here so switching providers is a config change. See PRD.md §9.

export type ProviderId = "anthropic" | "openai" | "google" | "deepseek" | "openrouter";

export interface ProviderConfig {
  label: string;
  // Vercel AI Gateway model id prefix (gateway routes "provider/model" strings
  // to the right underlying API — see https://vercel.com/docs/ai-gateway).
  gatewayPrefix: string;
  models: Record<string, string>; // friendly alias -> real model id
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  anthropic: {
    label: "Claude",
    gatewayPrefix: "anthropic",
    models: {
      default: "claude-sonnet-4-6",
      fast: "claude-haiku-4-5-20251001",
    },
  },
  openai: {
    label: "ChatGPT",
    gatewayPrefix: "openai",
    models: {
      default: "gpt-5",
    },
  },
  google: {
    label: "Gemini",
    gatewayPrefix: "google",
    models: {
      default: "gemini-3-pro",
    },
  },
  deepseek: {
    label: "DeepSeek",
    gatewayPrefix: "deepseek",
    models: {
      default: "deepseek-v4",
    },
  },
  // Kept as a manual fallback path (not gateway-routed) — useful if a model
  // isn't yet in Vercel's gateway catalog, or for local dev without a
  // Vercel deployment. See client.ts callOpenRouterDirect().
  openrouter: {
    label: "OpenRouter (fallback)",
    gatewayPrefix: "openrouter",
    models: {
      default: "anthropic/claude-sonnet-4-6",
    },
  },
};

// Default provider + model alias per AI feature. Change these to re-point
// a feature at a different provider without touching the feature's code.
export const FEATURE_DEFAULTS: Record<
  string,
  { provider: ProviderId; model: string }
> = {
  fieldPlacement: { provider: "anthropic", model: "default" },
  signerSummary: { provider: "anthropic", model: "fast" },
  signerQA: { provider: "anthropic", model: "default" },
  auditAnomaly: { provider: "anthropic", model: "default" },
  templateAssistant: { provider: "anthropic", model: "default" },
};
