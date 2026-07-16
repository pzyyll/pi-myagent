// ABOUTME: Tests official xAI prefab pricing lookup and product-id aliases.
// ABOUTME: Rates must match docs.x.ai short-context Text API table.
import { describe, expect, it } from "bun:test";
import { OFFICIAL_XAI_PRICING, resolveXaiModelCost, ZERO_COST } from "./pricing";

describe("resolveXaiModelCost", () => {
	it("returns official short-context rates for grok-4.5", () => {
		expect(resolveXaiModelCost("grok-4.5")).toEqual({
			input: 2.0,
			output: 6.0,
			cacheRead: 0.5,
			cacheWrite: 0,
		});
	});

	it("maps grok-build product id to grok-build-0.1 rates", () => {
		expect(resolveXaiModelCost("grok-build")).toEqual(OFFICIAL_XAI_PRICING["grok-build-0.1"]);
		expect(resolveXaiModelCost("grok-build-0.1")).toEqual({
			input: 1.0,
			output: 2.0,
			cacheRead: 0.2,
			cacheWrite: 0,
		});
	});

	it("prices grok-composer-2.5-fast and common aliases", () => {
		const expected = { input: 0.5, output: 2.5, cacheRead: 0.2, cacheWrite: 0 };
		expect(resolveXaiModelCost("grok-composer-2.5-fast")).toEqual(expected);
		expect(resolveXaiModelCost("grok-compose-2.5-fast")).toEqual(expected);
		expect(resolveXaiModelCost("composer-2.5-fast")).toEqual(expected);
	});

	it("returns zero cost for unknown models (no silent invent)", () => {
		expect(resolveXaiModelCost("totally-unknown-model")).toEqual(ZERO_COST);
	});

	it("returns a copy so callers cannot mutate the table", () => {
		const a = resolveXaiModelCost("grok-4.5");
		a.input = 99;
		expect(resolveXaiModelCost("grok-4.5").input).toBe(2.0);
	});
});
