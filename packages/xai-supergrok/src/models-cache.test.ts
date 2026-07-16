// ABOUTME: Tests SuperGrok ~/.pi/agent/grok_models_cache.json load/save and ModelsCatalog projection.
// ABOUTME: Covers grok-build models_cache shape, TTL freshness, and warm-start fallback.
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogModel } from "./catalog";
import {
	buildModelsCacheMap,
	catalogFromCacheModelsMap,
	isModelsCacheFresh,
	loadModelsCatalogFromCache,
	MODELS_CACHE_TTL_MS,
	saveModelsCatalogToCache,
} from "./models-cache";

const dirs: string[] = [];

afterEach(() => {
	while (dirs.length) {
		const dir = dirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "xai-supergrok-models-"));
	dirs.push(dir);
	return dir;
}

const sampleCatalog: CatalogModel[] = [
	{
		id: "grok-4.5",
		name: "Grok 4.5",
		reasoning: true,
		reasoningEfforts: ["high", "medium", "low"],
		input: ["text", "image"],
		cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 500_000,
		maxTokens: 128_000,
	},
];

describe("models cache", () => {
	it("saves and loads ModelsCatalog from grok_models_cache.json", () => {
		const dir = tempDir();
		const path = join(dir, "grok_models_cache.json");
		saveModelsCatalogToCache(sampleCatalog, {
			origin: "https://cli-chat-proxy.grok.com/v1/models",
			grokVersion: "0.2.101",
			authMethod: "session",
			etag: 'W/"abc"',
			path,
		});

		const raw = JSON.parse(readFileSync(path, "utf8")) as {
			auth_method: string;
			models: Record<string, { info: { id: string; supports_reasoning_effort: boolean } }>;
		};
		expect(raw.auth_method).toBe("session");
		expect(raw.models["grok-4.5"]?.info.id).toBe("grok-4.5");
		expect(raw.models["grok-4.5"]?.info.supports_reasoning_effort).toBe(true);

		const loaded = loadModelsCatalogFromCache({
			piPath: path,
			includeGrokBuildCache: false,
			expectedOrigin: "https://cli-chat-proxy.grok.com/v1/models",
			expectedAuthMethod: "session",
		});
		expect(loaded?.fresh).toBe(true);
		expect(loaded?.models.map((m) => m.id)).toEqual(["grok-4.5"]);
		expect(loaded?.models[0]?.reasoning).toBe(true);
		expect(loaded?.models[0]?.reasoningEfforts).toEqual(["high", "medium", "low"]);
		expect(loaded?.etag).toBe('W/"abc"');
	});

	it("parses grok-build models_cache.json info map", () => {
		const map = {
			"grok-4.5": {
				info: {
					id: "grok-4.5",
					model: "grok-4.5",
					name: "Grok 4.5",
					context_window: 500000,
					supports_reasoning_effort: true,
					reasoning_efforts: [{ value: "high" }, { value: "low" }],
					hidden: false,
				},
				api_key: null,
				env_key: null,
				api_base_url: null,
			},
			hidden: {
				info: {
					id: "hidden-model",
					model: "hidden-model",
					hidden: true,
				},
			},
		};
		const models = catalogFromCacheModelsMap(map);
		expect(models.map((m) => m.id)).toEqual(["grok-4.5"]);
		expect(models[0]?.reasoningEfforts).toEqual(["high", "low"]);
	});

	it("warm-starts from grok-build models_cache when pi cache is missing", () => {
		const dir = tempDir();
		const grokBuildPath = join(dir, "models_cache.json");
		writeFileSync(
			grokBuildPath,
			JSON.stringify({
				fetched_at: new Date().toISOString(),
				auth_method: "session",
				origin: "https://cli-chat-proxy.grok.com/v1/models",
				models: buildModelsCacheMap(sampleCatalog),
			}),
		);

		const loaded = loadModelsCatalogFromCache({
			piPath: join(dir, "missing-pi-cache.json"),
			grokBuildPath,
			expectedOrigin: "https://cli-chat-proxy.grok.com/v1/models",
			expectedAuthMethod: "session",
		});
		expect(loaded?.source).toBe("grok-build");
		expect(loaded?.models[0]?.id).toBe("grok-4.5");
	});

	it("reports stale cache via isModelsCacheFresh", () => {
		expect(isModelsCacheFresh({ fetched_at: new Date().toISOString() })).toBe(true);
		expect(
			isModelsCacheFresh({
				fetched_at: new Date(Date.now() - MODELS_CACHE_TTL_MS - 1000).toISOString(),
			}),
		).toBe(false);
	});

	it("requireFresh rejects stale pi cache", () => {
		const dir = tempDir();
		const path = join(dir, "grok_models_cache.json");
		writeFileSync(
			path,
			JSON.stringify({
				fetched_at: new Date(Date.now() - MODELS_CACHE_TTL_MS - 5_000).toISOString(),
				auth_method: "session",
				origin: "https://cli-chat-proxy.grok.com/v1/models",
				models: buildModelsCacheMap(sampleCatalog),
			}),
		);

		const staleOk = loadModelsCatalogFromCache({
			piPath: path,
			includeGrokBuildCache: false,
		});
		expect(staleOk?.fresh).toBe(false);
		expect(staleOk?.models.length).toBe(1);

		const required = loadModelsCatalogFromCache({
			piPath: path,
			includeGrokBuildCache: false,
			requireFresh: true,
		});
		expect(required).toBeUndefined();
	});
});
