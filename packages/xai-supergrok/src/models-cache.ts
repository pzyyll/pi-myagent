// ABOUTME: Disk cache for SuperGrok model catalog at ~/.pi/agent/grok_models_cache.json.
// ABOUTME: Mirrors grok-build models_cache.json shape and loads CatalogModel entries for Pi.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type CatalogModel,
  isAlwaysOnReasoningModel,
  isRecord,
  parseRemoteModelEntry,
  parseRemoteModels,
} from "./catalog";

/** CCP supportsReasoningEffort: true only when effort is selectable (not always-on). */
function catalogSupportsReasoningEffort(model: CatalogModel): boolean {
  if (!model.reasoning) return false;
  if (model.reasoningEfforts && model.reasoningEfforts.length > 0) return true;
  // Always-on models reason without selectable effort — keep CCP flag false.
  if (isAlwaysOnReasoningModel(model.id)) return false;
  return true;
}
import { grokBuildModelsCachePath, grokModelsCachePath } from "./paths";

/** Match grok-build ModelsCacheManager TTL (5 minutes). */
export const MODELS_CACHE_TTL_MS = 300_000;

export type CacheAuthMethod = "session" | "api_key" | "deployment";

export interface ModelsCacheFile {
  fetched_at: string;
  grok_version?: string;
  auth_method?: CacheAuthMethod | string;
  origin?: string;
  etag?: string;
  /** grok-build: map of model id → { info, api_key, env_key, api_base_url }. */
  models: Record<string, unknown>;
}

export interface LoadModelsCacheResult {
  models: CatalogModel[];
  etag?: string;
  fresh: boolean;
  origin?: string;
  source: "pi" | "grok-build";
}

function parseFetchedAtMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

export function isModelsCacheFresh(
  cache: Pick<ModelsCacheFile, "fetched_at">,
  ttlMs: number = MODELS_CACHE_TTL_MS,
  nowMs: number = Date.now(),
): boolean {
  const fetched = parseFetchedAtMs(cache.fetched_at);
  if (fetched === undefined) return false;
  const age = nowMs - fetched;
  return age >= 0 && age < ttlMs;
}

function readJsonFile(path: string): unknown | undefined {
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (!raw) return undefined;
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Convert a models_cache-style `models` map into CatalogModel[].
 * Accepts either full `{ info: {...} }` entries or bare remote model objects.
 */
export function catalogFromCacheModelsMap(models: unknown): CatalogModel[] {
  if (!isRecord(models)) return [];
  const out: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(models)) {
    let entry: unknown = value;
    if (isRecord(value) && value.info !== undefined) {
      entry = value.info;
    }
    const parsed = parseRemoteModelEntry(entry);
    if (!parsed) continue;
    // Prefer map key when info.id/model missing aliases already handled.
    const id = parsed.id || key;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id === parsed.id ? parsed : { ...parsed, id });
  }
  return out;
}

function parseModelsCacheFile(value: unknown): ModelsCacheFile | undefined {
  if (!isRecord(value)) return undefined;
  if (!isRecord(value.models) && !Array.isArray(value.models)) return undefined;
  const models = isRecord(value.models)
    ? value.models
    : Object.fromEntries(
        (value.models as unknown[]).map((m, i) => {
          const id =
            (isRecord(m) && (typeof m.id === "string" ? m.id : typeof m.model === "string" ? m.model : undefined)) ||
            `model-${i}`;
          return [id, m];
        }),
      );
  if (typeof value.fetched_at !== "string") {
    // Allow legacy / partial files by stamping epoch so they count as stale.
    return {
      fetched_at: new Date(0).toISOString(),
      ...(typeof value.grok_version === "string" ? { grok_version: value.grok_version } : {}),
      ...(typeof value.auth_method === "string" ? { auth_method: value.auth_method } : {}),
      ...(typeof value.origin === "string" ? { origin: value.origin } : {}),
      ...(typeof value.etag === "string" ? { etag: value.etag } : {}),
      models,
    };
  }
  return {
    fetched_at: value.fetched_at,
    ...(typeof value.grok_version === "string" ? { grok_version: value.grok_version } : {}),
    ...(typeof value.auth_method === "string" ? { auth_method: value.auth_method } : {}),
    ...(typeof value.origin === "string" ? { origin: value.origin } : {}),
    ...(typeof value.etag === "string" ? { etag: value.etag } : {}),
    models,
  };
}

function loadCacheAt(
  path: string,
  source: "pi" | "grok-build",
  opts?: { requireFresh?: boolean; expectedOrigin?: string; expectedAuthMethod?: CacheAuthMethod },
): LoadModelsCacheResult | undefined {
  const parsed = parseModelsCacheFile(readJsonFile(path));
  if (!parsed) return undefined;

  if (opts?.expectedOrigin && parsed.origin && parsed.origin !== opts.expectedOrigin) {
    return undefined;
  }
  if (opts?.expectedAuthMethod && parsed.auth_method && parsed.auth_method !== opts.expectedAuthMethod) {
    return undefined;
  }

  const models = catalogFromCacheModelsMap(parsed.models);
  if (models.length === 0) return undefined;

  const fresh = isModelsCacheFresh(parsed);
  if (opts?.requireFresh && !fresh) return undefined;

  return {
    models,
    etag: parsed.etag,
    fresh,
    origin: parsed.origin,
    source,
  };
}

/**
 * Load ModelsCatalog from disk.
 * Order: pi `~/.pi/agent/grok_models_cache.json` → (optional) grok-build `~/.grok/models_cache.json`.
 */
export function loadModelsCatalogFromCache(opts?: {
  requireFresh?: boolean;
  expectedOrigin?: string;
  expectedAuthMethod?: CacheAuthMethod;
  /** When true (default), fall back to grok-build models_cache.json if pi cache misses. */
  includeGrokBuildCache?: boolean;
  piPath?: string;
  grokBuildPath?: string;
}): LoadModelsCacheResult | undefined {
  const pi = loadCacheAt(opts?.piPath ?? grokModelsCachePath(), "pi", opts);
  if (pi) return pi;

  if (opts?.includeGrokBuildCache === false) return undefined;
  return loadCacheAt(opts?.grokBuildPath ?? grokBuildModelsCachePath(), "grok-build", opts);
}

/** Build a models_cache map from catalog + optional raw remote entries. */
export function buildModelsCacheMap(
  catalog: CatalogModel[],
  rawEntries?: unknown[],
  baseUrl: string = "https://cli-chat-proxy.grok.com/v1",
): Record<string, unknown> {
  const rawById = new Map<string, unknown>();
  if (rawEntries) {
    for (const raw of rawEntries) {
      const parsed = parseRemoteModelEntry(raw);
      if (parsed) rawById.set(parsed.id, raw);
    }
  }

  const models: Record<string, unknown> = {};
  for (const model of catalog) {
    const raw = rawById.get(model.id);
    const info = isRecord(raw)
      ? {
          ...raw,
          id: model.id,
          model: (typeof raw.model === "string" && raw.model) || model.id,
          name: model.name,
          base_url:
            (typeof raw.base_url === "string" && raw.base_url) ||
            (typeof raw.baseUrl === "string" && raw.baseUrl) ||
            baseUrl,
          context_window: model.contextWindow,
          max_completion_tokens: model.maxTokens,
          supports_reasoning_effort: catalogSupportsReasoningEffort(model),
          ...(model.reasoningEfforts
            ? {
                reasoning_efforts: model.reasoningEfforts.map((value) => ({
                  id: value,
                  value,
                  label: value,
                  default: false,
                })),
              }
            : {}),
          hidden: false,
        }
      : {
          id: model.id,
          model: model.id,
          name: model.name,
          base_url: baseUrl,
          context_window: model.contextWindow,
          max_completion_tokens: model.maxTokens,
          supports_reasoning_effort: catalogSupportsReasoningEffort(model),
          ...(model.reasoningEfforts
            ? {
                reasoning_efforts: model.reasoningEfforts.map((value) => ({
                  id: value,
                  value,
                  label: value,
                  default: false,
                })),
              }
            : {}),
          hidden: false,
          supported_in_api: true,
        };

    models[model.id] = {
      info,
      api_key: null,
      env_key: null,
      api_base_url: null,
    };
  }
  return models;
}

export function saveModelsCatalogToCache(
  catalog: CatalogModel[],
  meta: {
    origin: string;
    grokVersion?: string;
    authMethod?: CacheAuthMethod;
    etag?: string;
    rawEntries?: unknown[];
    baseUrl?: string;
    path?: string;
    fetchedAt?: Date;
  },
): void {
  if (catalog.length === 0) return;
  const cache: ModelsCacheFile = {
    fetched_at: (meta.fetchedAt ?? new Date()).toISOString(),
    ...(meta.grokVersion ? { grok_version: meta.grokVersion } : {}),
    auth_method: meta.authMethod ?? "session",
    origin: meta.origin,
    ...(meta.etag ? { etag: meta.etag } : {}),
    models: buildModelsCacheMap(catalog, meta.rawEntries, meta.baseUrl),
  };
  atomicWriteJson(meta.path ?? grokModelsCachePath(), cache);
}

/** Parse OpenAI-style list payload into catalog + raw entries for cache persistence. */
export function catalogAndRawFromListPayload(payload: unknown): {
  models: CatalogModel[];
  rawEntries: unknown[];
} {
  const models = parseRemoteModels(payload);
  const rawEntries = isRecord(payload) && Array.isArray(payload.data) ? (payload.data as unknown[]) : [];
  return { models, rawEntries };
}
