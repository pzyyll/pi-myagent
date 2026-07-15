// ABOUTME: Unit tests for SuperGrok remote /v1/models catalog parsing.
// ABOUTME: Covers field aliases, hidden filtering, and JWT user id peeks.
import { describe, expect, it } from "bun:test";
import {
	DEFAULT_CONTEXT_WINDOW,
	FALLBACK_CATALOG,
	modelsListUrl,
	parseRemoteModelEntry,
	parseRemoteModels,
	peekJwtUserId,
	sanitizeModelsCatalog,
} from "./catalog";

describe("FALLBACK_CATALOG", () => {
	it("includes grok-4.5 as a bake-in model when remote catalog is unavailable", () => {
		expect(FALLBACK_CATALOG.map((m) => m.id)).toContain("grok-4.5");
		const grok45 = FALLBACK_CATALOG.find((m) => m.id === "grok-4.5");
		expect(grok45?.name).toBe("Grok 4.5");
		expect(grok45?.reasoning).toBe(true);
		expect(grok45?.contextWindow).toBe(500_000);
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
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 500_000,
			maxTokens: 64_000,
		});
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
