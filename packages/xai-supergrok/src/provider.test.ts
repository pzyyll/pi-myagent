// ABOUTME: Tests SuperGrok provider seed models and oauth.modifyModels catalog swap.
// ABOUTME: Covers Pi 0.80.7 non-empty models seed + remote catalog override boundaries.
import { describe, expect, it } from "bun:test";
import type { Api, Model, OAuthCredentials } from "@earendil-works/pi-ai";
import {
	catalogToModel,
	catalogToProviderModelConfig,
	FALLBACK_CATALOG,
	modifyXaiModelsForOAuth,
	PROVIDER_ID,
	SEED_MODELS,
} from "./index";
import type { CatalogModel } from "./catalog";

function seedAsRegistryModels(): Model<Api>[] {
	// Mirrors applyProviderConfig: ProviderModelConfig → Model with provider/baseUrl/api filled in.
	return SEED_MODELS.map((cfg) => ({
		id: cfg.id,
		name: cfg.name,
		api: "openai-responses" as const,
		provider: PROVIDER_ID,
		baseUrl: "https://cli-chat-proxy.grok.com/v1",
		reasoning: cfg.reasoning,
		thinkingLevelMap: cfg.thinkingLevelMap,
		input: cfg.input,
		cost: cfg.cost,
		contextWindow: cfg.contextWindow,
		maxTokens: cfg.maxTokens,
		compat: cfg.compat,
	}));
}

function oauthCreds(modelsCatalog?: CatalogModel[]): OAuthCredentials & { modelsCatalog?: CatalogModel[] } {
	return {
		refresh: "refresh-token",
		access: "access-token",
		expires: Date.now() + 3_600_000,
		...(modelsCatalog ? { modelsCatalog } : {}),
	};
}

describe("SEED_MODELS (Pi registerProvider seed)", () => {
	it("is non-empty so Pi 0.80.7 enters the models + modifyModels branch", () => {
		// applyProviderConfig only registers models / calls modifyModels when models.length > 0
		expect(SEED_MODELS.length).toBeGreaterThan(0);
	});

	it("registers grok-4.5 from FALLBACK_CATALOG without a remote catalog", () => {
		expect(SEED_MODELS.map((m) => m.id)).toContain("grok-4.5");
		const grok45 = SEED_MODELS.find((m) => m.id === "grok-4.5");
		expect(grok45).toMatchObject({
			id: "grok-4.5",
			name: "Grok 4.5",
			reasoning: true,
			contextWindow: 500_000,
			maxTokens: 128_000,
			input: ["text", "image"],
		});
		// Shared compat / reasoning map from catalog conversion helpers
		expect(grok45?.compat).toEqual({
			supportsDeveloperRole: false,
			sendSessionIdHeader: false,
			supportsLongCacheRetention: false,
		});
		expect(grok45?.thinkingLevelMap).toEqual({ off: null, minimal: null });
	});

	it("mirrors FALLBACK_CATALOG ids (single source of truth)", () => {
		expect(SEED_MODELS.map((m) => m.id)).toEqual(FALLBACK_CATALOG.map((m) => m.id));
	});

	it("catalogToProviderModelConfig reuses the same field mapping as catalogToModel", () => {
		const entry = FALLBACK_CATALOG[0]!;
		const cfg = catalogToProviderModelConfig(entry);
		const model = catalogToModel(entry);
		expect(cfg.id).toBe(model.id);
		expect(cfg.name).toBe(model.name);
		expect(cfg.reasoning).toBe(model.reasoning);
		expect(cfg.thinkingLevelMap).toEqual(model.thinkingLevelMap);
		expect(cfg.input).toEqual(model.input);
		expect(cfg.cost).toEqual(model.cost);
		expect(cfg.contextWindow).toBe(model.contextWindow);
		expect(cfg.maxTokens).toBe(model.maxTokens);
		expect(cfg.compat).toEqual(model.compat);
		expect(model.provider).toBe(PROVIDER_ID);
		expect(model.api).toBe("openai-responses");
		expect(model.baseUrl).toBe("https://cli-chat-proxy.grok.com/v1");
	});
});

describe("modifyXaiModelsForOAuth (credential catalog vs seed)", () => {
	it("keeps FALLBACK / seed models when credentials have no remote catalog", () => {
		const seed = seedAsRegistryModels();
		const other: Model<Api> = {
			id: "other-model",
			name: "Other",
			api: "openai-responses",
			provider: "other-provider",
			baseUrl: "https://example.com",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000,
			maxTokens: 500,
		};

		const result = modifyXaiModelsForOAuth([other, ...seed], oauthCreds());
		const ours = result.filter((m) => m.provider === PROVIDER_ID);
		const others = result.filter((m) => m.provider !== PROVIDER_ID);

		expect(others.map((m) => m.id)).toEqual(["other-model"]);
		expect(ours.map((m) => m.id)).toEqual(FALLBACK_CATALOG.map((m) => m.id));
		expect(ours.map((m) => m.id)).toContain("grok-4.5");
		expect(ours.every((m) => m.baseUrl === "https://cli-chat-proxy.grok.com/v1")).toBe(true);
	});

	it("replaces seed with remote modelsCatalog when present on credentials", () => {
		const seed = seedAsRegistryModels();
		const remote: CatalogModel[] = [
			{
				id: "remote-only",
				name: "Remote Only",
				reasoning: false,
				input: ["text"],
				cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 42_000,
				maxTokens: 8_000,
			},
			{
				id: "grok-4.5",
				name: "Grok 4.5 (entitled)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 500_000,
				maxTokens: 64_000,
			},
		];

		const result = modifyXaiModelsForOAuth(seed, oauthCreds(remote));
		const ours = result.filter((m) => m.provider === PROVIDER_ID);

		// Seed fully replaced — no leftover seed-only ids like grok-build unless remote listed it
		expect(ours.map((m) => m.id)).toEqual(["remote-only", "grok-4.5"]);
		expect(ours.map((m) => m.id)).not.toContain("grok-build");
		expect(ours.find((m) => m.id === "grok-4.5")?.name).toBe("Grok 4.5 (entitled)");
		expect(ours.find((m) => m.id === "grok-4.5")?.maxTokens).toBe(64_000);
		expect(ours.find((m) => m.id === "remote-only")?.contextWindow).toBe(42_000);
	});

	it("ignores invalid modelsCatalog and falls back to FALLBACK_CATALOG", () => {
		const seed = seedAsRegistryModels();
		const creds = oauthCreds();
		// Corrupt catalog as auth.json might store garbage — sanitize drops it
		(creds as { modelsCatalog: unknown }).modelsCatalog = [{ id: "not-a-full-entry" }];

		const result = modifyXaiModelsForOAuth(seed, creds);
		expect(result.filter((m) => m.provider === PROVIDER_ID).map((m) => m.id)).toEqual(
			FALLBACK_CATALOG.map((m) => m.id),
		);
	});
});
