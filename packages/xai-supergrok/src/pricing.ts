// ABOUTME: Prefab USD-per-1M-token rates from official xAI docs for Pi usage display.
// ABOUTME: Source: https://docs.x.ai/developers/pricing (short-context / standard tier).

import type { CatalogModel } from "./catalog";

/** Pi cost fields: USD per 1M tokens. */
export type ModelCost = CatalogModel["cost"];

/**
 * Prefab USD / 1M token rates for Pi usage display.
 * Long-context / priority / batch multipliers are not modeled here.
 * cacheWrite is 0 — xAI bills cache hits as cached input, not a separate write fee.
 *
 * Primary source: https://docs.x.ai/developers/pricing (Text API short-context table).
 * Grok Build–only models (e.g. composer) may be absent from that table; those rows
 * use the rates published with the product announcement / models.dev catalog.
 */
export const OFFICIAL_XAI_PRICING: Record<string, ModelCost> = {
  // docs.x.ai/developers/pricing
  "grok-build-0.1": { input: 1.0, output: 2.0, cacheRead: 0.2, cacheWrite: 0 },
  "grok-4.5": { input: 2.0, output: 6.0, cacheRead: 0.5, cacheWrite: 0 },
  "grok-4.3": { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
  "grok-4.20-multi-agent-0309": { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
  "grok-4.20-0309-reasoning": { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
  "grok-4.20-0309-non-reasoning": { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
  // Grok Build OAuth surface (not on public Text API pricing table as of fetch).
  // https://x.ai/news/composer-2-5 · models.dev: $0.50 / $2.50 / cache $0.20
  "grok-composer-2.5-fast": { input: 0.5, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
};

/** cli-chat-proxy / product aliases → canonical pricing id. */
const PRICING_ALIASES: Record<string, string> = {
  "grok-build": "grok-build-0.1",
  "grok-build-latest": "grok-build-0.1",
  "grok-4.5-latest": "grok-4.5",
  "grok-4.3-latest": "grok-4.3",
  // common misspell / short forms
  "grok-compose-2.5-fast": "grok-composer-2.5-fast",
  "composer-2.5-fast": "grok-composer-2.5-fast",
};

export const ZERO_COST: ModelCost = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

/** Resolve official rates for a model id; unknown ids → zero (no silent guess). */
export function resolveXaiModelCost(modelId: string): ModelCost {
  const canonical = PRICING_ALIASES[modelId] ?? modelId;
  const rates = OFFICIAL_XAI_PRICING[canonical];
  return rates ? { ...rates } : { ...ZERO_COST };
}
