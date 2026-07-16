// ABOUTME: Unit tests for SuperGrok remote /v1/models catalog parsing.
// ABOUTME: Covers field aliases, hidden filtering, and JWT user id peeks.
import { describe, expect, it } from "bun:test";
import {
	ALWAYS_ON_REASONING_THINKING_LEVEL_MAP,
	buildThinkingLevelMap,
	DEFAULT_CONTEXT_WINDOW,
	FALLBACK_CATALOG,
	isAlwaysOnReasoningModel,
	LEGACY_REASONING_EFFORTS,
	modelsListUrl,
	parseReasoningEffortOptions,
	parseReasoningEffortToken,
	parseRemoteModelEntry,
	parseRemoteModels,
	peekJwtUserId,
	sanitizeModelsCatalog,
	thinkingLevelMapForCatalog,
} from "./catalog";

describe("FALLBACK_CATALOG", () => {
	it("includes grok-4.5 as a bake-in model when remote catalog is unavailable", () => {
		expect(FALLBACK_CATALOG.map((m) => m.id)).toContain("grok-4.5");
		const grok45 = FALLBACK_CATALOG.find((m) => m.id === "grok-4.5");
		expect(grok45?.name).toBe("Grok 4.5");
		expect(grok45?.reasoning).toBe(true);
		expect(grok45?.contextWindow).toBe(500_000);
		expect(grok45?.cost).toEqual({ input: 2.0, output: 6.0, cacheRead: 0.5, cacheWrite: 0 });
	});

	it("marks grok-build as non-effort (supportsReasoningEffort false)", () => {
		const grokBuild = FALLBACK_CATALOG.find((m) => m.id === "grok-build");
		expect(grokBuild?.reasoning).toBe(false);
	});
});

describe("parseRemoteModelEntry", () => {
	it("parses camelCase grok-build style entries", () => {
		const model = parseRemoteModelEntry({
			id: "grok-build",
			name: "Grok Build",
			contextWindow: 500_000,
			maxCompletionTokens: 64_000,
			supportsReasoningEffort: true,
			supportedInApi: false,
		});
		expect(model).toEqual({
			id: "grok-build",
			name: "Grok Build",
			reasoning: true,
			input: ["text", "image"],
			// alias → official grok-build-0.1 short-context rates
			cost: { input: 1.0, output: 2.0, cacheRead: 0.2, cacheWrite: 0 },
			contextWindow: 500_000,
			maxTokens: 64_000,
		});
		expect(model?.reasoningEfforts).toBeUndefined();
	});

	it("parses reasoningEfforts bare strings and value tables", () => {
		const model = parseRemoteModelEntry({
			id: "grok-4.5",
			supportsReasoningEffort: true,
			reasoningEfforts: [{ value: "max", id: "deep", label: "Deep" }, "low", { value: "bogus" }, 42],
		});
		expect(model?.reasoningEfforts).toEqual(["xhigh", "low"]);
	});

	it("reads reasoning_efforts from _meta and ignores when effort unsupported", () => {
		const withMeta = parseRemoteModelEntry({
			model: "m1",
			supportsReasoningEffort: true,
			_meta: { reasoning_efforts: ["high"] },
		});
		expect(withMeta?.reasoningEfforts).toEqual(["high"]);

		const unsupported = parseRemoteModelEntry({
			id: "m2",
			supportsReasoningEffort: false,
			reasoningEfforts: ["high"],
		});
		expect(unsupported?.reasoningEfforts).toBeUndefined();
	});

	it("marks composer-2.5 as reasoning even when supportsReasoningEffort is false", () => {
		expect(isAlwaysOnReasoningModel("grok-composer-2.5-fast")).toBe(true);

		const model = parseRemoteModelEntry({
			id: "grok-composer-2.5-fast",
			name: "Composer 2.5",
			supportsReasoningEffort: false,
			reasoningEfforts: ["high", "xhigh"],
			contextWindow: 200_000,
		});
		expect(model?.reasoning).toBe(true);
		// Effort menu ignored when server says effort is not selectable.
		expect(model?.reasoningEfforts).toBeUndefined();
		expect(thinkingLevelMapForCatalog(model!)).toEqual(ALWAYS_ON_REASONING_THINKING_LEVEL_MAP);
	});

	it("accepts snake_case aliases and _meta fields", () => {
		const model = parseRemoteModelEntry({
			model: "grok-4.5",
			context_window: 400_000,
			_meta: {
				supportsReasoningEffort: true,
				totalContextTokens: 999,
			},
		});
		expect(model?.id).toBe("grok-4.5");
		expect(model?.name).toBe("grok-4.5");
		expect(model?.contextWindow).toBe(400_000);
		expect(model?.reasoning).toBe(true);
	});

	it("defaults context window and max tokens when omitted", () => {
		const model = parseRemoteModelEntry({ model: "m1" });
		expect(model?.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
		expect(model?.maxTokens).toBe(Math.min(DEFAULT_CONTEXT_WINDOW, 128_000));
		expect(model?.reasoning).toBe(false);
	});

	it("skips hidden models", () => {
		expect(parseRemoteModelEntry({ id: "secret", hidden: true })).toBeUndefined();
		expect(parseRemoteModelEntry({ id: "secret", _meta: { hidden: true } })).toBeUndefined();
	});

	it("keeps supported_in_api false models (session/OAuth path)", () => {
		const model = parseRemoteModelEntry({
			id: "grok-build",
			supported_in_api: false,
			contextWindow: 500_000,
		});
		expect(model?.id).toBe("grok-build");
	});
});

describe("parseRemoteModels", () => {
	it("parses data array and dedupes by id", () => {
		const models = parseRemoteModels({
			data: [
				{ id: "a", name: "A", contextWindow: 1000 },
				{ model: "a", name: "A2", contextWindow: 2000 },
				{ id: "b", name: "B", contextWindow: 3000 },
				{ hidden: true, id: "c" },
			],
		});
		expect(models.map((m) => m.id)).toEqual(["a", "b"]);
		expect(models[0]?.name).toBe("A");
	});

	it("returns empty for invalid payloads", () => {
		expect(parseRemoteModels(null)).toEqual([]);
		expect(parseRemoteModels({})).toEqual([]);
		expect(parseRemoteModels({ data: "nope" })).toEqual([]);
	});
});

describe("sanitizeModelsCatalog", () => {
	it("keeps valid catalog entries only", () => {
		const cleaned = sanitizeModelsCatalog([
			{
				id: "x",
				name: "X",
				reasoning: false,
				input: ["text"],
				cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 10,
				maxTokens: 5,
			},
			{ id: "bad" },
		]);
		expect(cleaned).toHaveLength(1);
		expect(cleaned?.[0]?.id).toBe("x");
	});

	it("keeps valid reasoningEfforts and drops junk", () => {
		const cleaned = sanitizeModelsCatalog([
			{
				id: "y",
				name: "Y",
				reasoning: true,
				reasoningEfforts: ["high", "nope", "max"],
				input: ["text"],
				cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 10,
				maxTokens: 5,
			},
		]);
		expect(cleaned?.[0]?.reasoningEfforts).toEqual(["high", "xhigh"]);
	});
});

describe("reasoning effort parsing / thinkingLevelMap", () => {
	it("parseReasoningEffortToken accepts max as xhigh", () => {
		expect(parseReasoningEffortToken("max")).toBe("xhigh");
		expect(parseReasoningEffortToken("XHIGH")).toBe("xhigh");
		expect(parseReasoningEffortToken("nope")).toBeUndefined();
	});

	it("parseReasoningEffortOptions skips invalid and dedupes", () => {
		expect(parseReasoningEffortOptions(["high", "high", { value: "low" }, "bogus"])).toEqual(["high", "low"]);
		expect(parseReasoningEffortOptions([])).toBeUndefined();
		expect(parseReasoningEffortOptions("nope")).toBeUndefined();
	});

	it("buildThinkingLevelMap defaults to legacy low..xhigh", () => {
		expect(buildThinkingLevelMap()).toEqual({
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
		});
		expect(LEGACY_REASONING_EFFORTS).toEqual(["low", "medium", "high", "xhigh"]);
	});

	it("thinkingLevelMapForCatalog is undefined without reasoning", () => {
		expect(
			thinkingLevelMapForCatalog({
				id: "m",
				name: "M",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1,
				maxTokens: 1,
			}),
		).toBeUndefined();
	});

	it("thinkingLevelMapForCatalog locks always-on composer models to a fixed map", () => {
		expect(
			thinkingLevelMapForCatalog({
				id: "grok-composer-2.5-fast",
				name: "Composer 2.5",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1,
				maxTokens: 1,
			}),
		).toEqual(ALWAYS_ON_REASONING_THINKING_LEVEL_MAP);
	});
});

describe("peekJwtUserId", () => {
	it("reads sub from a JWT payload", () => {
		const json = JSON.stringify({ sub: "user-123" });
		const payload = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
		const token = `hdr.${payload}.sig`;
		expect(peekJwtUserId(token)).toBe("user-123");
	});

	it("returns undefined for non-JWT tokens", () => {
		expect(peekJwtUserId("not-a-jwt")).toBeUndefined();
	});
});

describe("modelsListUrl", () => {
	it("joins base url with /models", () => {
		expect(modelsListUrl("https://cli-chat-proxy.grok.com/v1")).toBe("https://cli-chat-proxy.grok.com/v1/models");
		expect(modelsListUrl("https://cli-chat-proxy.grok.com/v1/")).toBe("https://cli-chat-proxy.grok.com/v1/models");
	});
});
