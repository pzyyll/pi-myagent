// ABOUTME: Tests SuperGrok provider seed models, catalog refresh, and grok-build wire alignment.
// ABOUTME: Covers Responses body strip, product headers, and Pi 0.80.8 refreshModels boundaries.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OAuthCredentials, RefreshModelsContext } from "@earendil-works/pi-ai";
import {
	alignGrokBuildResponsesPayload,
	applyGrokBuildProductHeaders,
	catalogToModel,
	catalogToProviderModelConfig,
	credentialsWithoutModelsCatalog,
	FALLBACK_CATALOG,
	modelsFromDiskOrFallback,
	PROVIDER_ID,
	refreshXaiModels,
	SEED_MODELS,
} from "./index";
import type { CatalogModel } from "./catalog";
import { saveModelsCatalogToCache } from "./models-cache";
import { grokModelsCachePath } from "./paths";

function offlineRefreshContext(): RefreshModelsContext {
	return {
		allowNetwork: false,
		store: {
			read: async () => undefined,
			write: async () => {},
			delete: async () => {},
		},
	};
}

function onlineOAuthContext(access = "access-token"): RefreshModelsContext {
	return {
		allowNetwork: true,
		credential: {
			type: "oauth",
			access,
			refresh: "refresh-token",
			expires: Date.now() + 3_600_000,
		},
		store: {
			read: async () => undefined,
			write: async () => {},
			delete: async () => {},
		},
	};
}

function oauthCreds(): OAuthCredentials {
	return {
		refresh: "refresh-token",
		access: "access-token",
		expires: Date.now() + 3_600_000,
	};
}

describe("SEED_MODELS (Pi registerProvider seed)", () => {
	it("is non-empty so cold start has models before refreshModels", () => {
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
		expect(grok45?.compat).toEqual({
			supportsDeveloperRole: false,
			sessionAffinityFormat: "openai-nosession",
			supportsLongCacheRetention: false,
		});
		// Legacy menu when catalog omits reasoningEfforts (low..xhigh).
		expect(grok45?.thinkingLevelMap).toEqual({
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
		});
	});

	it("projects server reasoningEfforts into thinkingLevelMap", () => {
		const model = catalogToModel({
			id: "custom",
			name: "Custom",
			reasoning: true,
			reasoningEfforts: ["high", "xhigh"],
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000,
			maxTokens: 500,
		});
		expect(model.thinkingLevelMap).toEqual({
			off: null,
			minimal: null,
			low: null,
			medium: null,
			high: "high",
			xhigh: "xhigh",
		});
	});

	it("omits thinkingLevelMap for grok-build (no supportsReasoningEffort)", () => {
		const grokBuild = SEED_MODELS.find((m) => m.id === "grok-build");
		expect(grokBuild?.reasoning).toBe(false);
		expect(grokBuild?.thinkingLevelMap).toBeUndefined();
	});

	it("maps composer-2.5 to always-on reasoning with fixed thinkingLevelMap", () => {
		const model = catalogToModel({
			id: "grok-composer-2.5-fast",
			name: "Composer 2.5",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0.5, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
			contextWindow: 200_000,
			maxTokens: 128_000,
		});
		expect(model.reasoning).toBe(true);
		expect(model.thinkingLevelMap).toEqual({
			off: null,
			minimal: null,
			low: null,
			medium: null,
			high: "high",
			xhigh: null,
		});
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

describe("modelsFromDiskOrFallback + refreshXaiModels (Pi 0.80.8)", () => {
	let prevGrokHome: string | undefined;
	let prevAgentDir: string | undefined;
	let tempHome: string;

	beforeEach(() => {
		prevGrokHome = process.env.GROK_HOME;
		prevAgentDir = process.env.PI_CODING_AGENT_DIR;
		tempHome = mkdtempSync(join(tmpdir(), "xai-supergrok-provider-"));
		process.env.GROK_HOME = join(tempHome, "grok");
		process.env.PI_CODING_AGENT_DIR = join(tempHome, "agent");
	});

	afterEach(() => {
		if (prevGrokHome === undefined) delete process.env.GROK_HOME;
		else process.env.GROK_HOME = prevGrokHome;
		if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
		rmSync(tempHome, { recursive: true, force: true });
	});

	it("returns FALLBACK seed when disk cache is empty", () => {
		const models = modelsFromDiskOrFallback();
		expect(models.map((m) => m.id)).toEqual(FALLBACK_CATALOG.map((m) => m.id));
		expect(models.every((m) => m.id.length > 0)).toBe(true);
	});

	it("projects disk-cached ModelsCatalog (not credentials)", () => {
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

		saveModelsCatalogToCache(remote, {
			origin: "https://cli-chat-proxy.grok.com/v1/models",
			authMethod: "session",
			path: grokModelsCachePath(),
		});

		const models = modelsFromDiskOrFallback();
		expect(models.map((m) => m.id)).toEqual(["remote-only", "grok-4.5"]);
		expect(models.map((m) => m.id)).not.toContain("grok-build");
		expect(models.find((m) => m.id === "grok-4.5")?.name).toBe("Grok 4.5 (entitled)");
		expect(models.find((m) => m.id === "grok-4.5")?.maxTokens).toBe(64_000);
		expect(models.find((m) => m.id === "remote-only")?.contextWindow).toBe(42_000);
	});

	it("offline refreshModels returns disk/fallback without network", async () => {
		const models = await refreshXaiModels(offlineRefreshContext());
		expect(models.map((m) => m.id)).toEqual(FALLBACK_CATALOG.map((m) => m.id));
	});

	it("online refreshModels without oauth credential stays on disk/fallback", async () => {
		const models = await refreshXaiModels({
			allowNetwork: true,
			store: offlineRefreshContext().store,
		});
		expect(models.map((m) => m.id)).toEqual(FALLBACK_CATALOG.map((m) => m.id));
	});

	it("online refreshModels with oauth uses disk cache when network fetch fails", async () => {
		const remote: CatalogModel[] = [
			{
				id: "cached-only",
				name: "Cached Only",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 10_000,
				maxTokens: 1_000,
			},
		];
		saveModelsCatalogToCache(remote, {
			origin: "https://cli-chat-proxy.grok.com/v1/models",
			authMethod: "session",
			path: grokModelsCachePath(),
		});

		// Invalid token → fetch fails → disk cache preserved.
		const models = await refreshXaiModels(onlineOAuthContext("not-a-real-token"));
		expect(models.map((m) => m.id)).toEqual(["cached-only"]);
	});

	it("strips modelsCatalog from OAuth credentials for auth.json storage", () => {
		const dirty = {
			...oauthCreds(),
			modelsCatalog: [{ id: "nope" }],
			userId: "u1",
		} as OAuthCredentials & { modelsCatalog?: unknown; userId?: string };
		const clean = credentialsWithoutModelsCatalog(dirty);
		expect(clean.access).toBe("access-token");
		expect(clean.userId).toBe("u1");
		expect(Object.prototype.hasOwnProperty.call(clean, "modelsCatalog")).toBe(false);
	});
});

describe("alignGrokBuildResponsesPayload (body wire)", () => {
	it("strips prompt_cache_key and prompt_cache_retention (grok leaves both unset)", () => {
		const aligned = alignGrokBuildResponsesPayload({
			model: "grok-build",
			prompt_cache_key: "session-abc",
			prompt_cache_retention: "24h",
			store: false,
		}) as Record<string, unknown>;

		expect(aligned.model).toBe("grok-build");
		expect(aligned.store).toBe(false);
		expect("prompt_cache_key" in aligned).toBe(false);
		expect("prompt_cache_retention" in aligned).toBe(false);
	});

	it("forces reasoning.summary to concise when reasoning is present", () => {
		const aligned = alignGrokBuildResponsesPayload({
			reasoning: { effort: "high", summary: "auto" },
		}) as { reasoning: { effort: string; summary: string } };

		expect(aligned.reasoning).toEqual({ effort: "high", summary: "concise" });
	});

	it("injects reasoning.summary=concise when effort/reasoning is absent", () => {
		const aligned = alignGrokBuildResponsesPayload({
			model: "grok-build",
		}) as { reasoning: { summary: string; effort?: string } };

		expect(aligned.reasoning).toEqual({ summary: "concise" });
		expect(aligned.reasoning.effort).toBeUndefined();
	});

	it("strips effort for always-on composer models (supportsReasoningEffort=false)", () => {
		const aligned = alignGrokBuildResponsesPayload(
			{ reasoning: { effort: "high", summary: "auto" } },
			{ modelId: "grok-composer-2.5-fast" },
		) as { reasoning: { effort?: string; summary: string } };

		expect(aligned.reasoning).toEqual({ summary: "concise" });
		expect(aligned.reasoning.effort).toBeUndefined();
	});

	it("leaves non-object payloads untouched", () => {
		expect(alignGrokBuildResponsesPayload(null)).toBe(null);
		expect(alignGrokBuildResponsesPayload("x")).toBe("x");
	});
});

describe("applyGrokBuildProductHeaders", () => {
	it("sets session-id and model-override product headers", () => {
		const headers: Record<string, string | null> = {};
		applyGrokBuildProductHeaders(headers, {
			sessionId: "sess-1",
			modelId: "grok-4.5",
		});
		expect(headers["x-grok-session-id"]).toBe("sess-1");
		expect(headers["x-grok-model-override"]).toBe("grok-4.5");
		expect(headers["x-grok-user-id"]).toBeUndefined();
	});

	it("peeks JWT sub into x-grok-user-id when access token is present", () => {
		const payload = Buffer.from(JSON.stringify({ sub: "user-42" })).toString("base64url");
		const token = `aaa.${payload}.bbb`;
		const headers: Record<string, string | null> = {};
		applyGrokBuildProductHeaders(headers, { accessToken: token });
		expect(headers["x-grok-user-id"]).toBe("user-42");
	});
});
