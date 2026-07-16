// ABOUTME: Tests SuperGrok billing payload parsing and footer/detail rendering.
// ABOUTME: Covers credits percent, period labels, prepaid/on-demand, and legacy fields.
import { describe, expect, it } from "bun:test";
import { parseGrokPlanUsage, renderGrokPlanUsageDetails, renderGrokUsage } from "./grok-usage";
import type { ThemeColorName } from "./shared";

const NOW = Date.parse("2026-04-01T12:00:00.000Z");
const id = (_c: string, t: string) => t;

function creditsPayload(config: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown {
	return {
		config,
		...extra,
	};
}

describe("parseGrokPlanUsage", () => {
	it("parses creditUsagePercent and weekly period into a W window", () => {
		const u = parseGrokPlanUsage(
			creditsPayload({
				creditUsagePercent: 42.5,
				currentPeriod: {
					type: "USAGE_PERIOD_TYPE_WEEKLY",
					start: "2026-03-30T00:00:00Z",
					end: "2026-04-06T00:00:00Z",
				},
			}),
			NOW,
		);
		expect(u.usable).toBe(true);
		expect(u.usagePct).toBe(42.5);
		expect(u.windows).toHaveLength(1);
		expect(u.windows[0]!.label).toBe("W");
		expect(u.windows[0]!.usedPercent).toBe(42.5);
		expect(u.windows[0]!.resetsIn).toBe("4d 12h");
		expect(u.periodType).toBe("USAGE_PERIOD_TYPE_WEEKLY");
	});

	it("falls back to used/monthlyLimit when percent is absent", () => {
		const u = parseGrokPlanUsage(
			creditsPayload({
				monthlyLimit: { val: 2000 },
				used: { val: 500 },
				billingPeriodEnd: "2026-04-08T00:00:00Z",
			}),
			NOW,
		);
		expect(u.usagePct).toBe(25);
		expect(u.windows[0]!.usedPercent).toBe(25);
		expect(u.windows[0]!.label).toBe("Credits");
	});

	it("reads prepaid and on-demand caps in cents", () => {
		const u = parseGrokPlanUsage(
			creditsPayload(
				{
					creditUsagePercent: 100,
					onDemandCap: { val: 500 },
					onDemandUsed: { val: 250 },
					prepaidBalance: { val: 1250 },
					isUnifiedBillingUser: true,
				},
				{ onDemandEnabled: true, subscriptionTier: "SuperGrokPro" },
			),
			NOW,
		);
		expect(u.subscriptionTier).toBe("SuperGrokPro");
		expect(u.payAsYouGo).toBe(true);
		expect(u.onDemandEnabled).toBe(true);
		expect(u.onDemandCapCents).toBe(500);
		expect(u.onDemandUsedCents).toBe(250);
		expect(u.prepaidBalanceCents).toBe(1250);
		expect(u.isUnifiedBillingUser).toBe(true);
		expect(u.effectiveUsagePct).toBe(50);
	});

	it("clamps out-of-range percentages", () => {
		const high = parseGrokPlanUsage(creditsPayload({ creditUsagePercent: 150 }), NOW);
		expect(high.usagePct).toBe(100);
		const low = parseGrokPlanUsage(creditsPayload({ creditUsagePercent: -3 }), NOW);
		expect(low.usagePct).toBe(0);
	});

	it("is unusable for empty payloads", () => {
		expect(parseGrokPlanUsage({}, NOW).usable).toBe(false);
		expect(parseGrokPlanUsage(null, NOW).usable).toBe(false);
	});

	it("is usable when only subscription tier is present", () => {
		const u = parseGrokPlanUsage({ subscriptionTier: "SuperGrok" }, NOW);
		expect(u.usable).toBe(true);
		expect(u.windows).toHaveLength(0);
	});
});

describe("renderGrokUsage", () => {
	it("renders the Grok brand and credits window", () => {
		const u = parseGrokPlanUsage(
			creditsPayload({
				creditUsagePercent: 38,
				currentPeriod: {
					type: "USAGE_PERIOD_TYPE_WEEKLY",
					end: "2026-04-03T12:00:00Z",
				},
			}),
			NOW,
		);
		expect(renderGrokUsage(u, id)).toBe("Grok W ███░░░░░ 38% ⟳ 2d");
	});

	it("uses accent for the Grok prefix", () => {
		const u = parseGrokPlanUsage(creditsPayload({ creditUsagePercent: 10 }), NOW);
		const calls: Array<{ color: ThemeColorName; text: string }> = [];
		const trackingFg = (color: ThemeColorName, text: string): string => {
			calls.push({ color, text });
			return text;
		};
		renderGrokUsage(u, trackingFg);
		expect(calls.some((c) => c.text === "Grok" && c.color === "accent")).toBe(true);
	});
});

describe("renderGrokPlanUsageDetails", () => {
	it("renders plan tier, credits, period, prepaid, and on-demand lines", () => {
		const u = parseGrokPlanUsage(
			creditsPayload(
				{
					creditUsagePercent: 42,
					currentPeriod: {
						type: "USAGE_PERIOD_TYPE_WEEKLY",
						end: "2026-04-06T00:00:00Z",
					},
					prepaidBalance: { val: 1250 },
					onDemandCap: { val: 500 },
					onDemandUsed: { val: 100 },
					isUnifiedBillingUser: true,
				},
				{ subscriptionTier: "SuperGrokPro", onDemandEnabled: true },
			),
			NOW,
		);
		const lines = renderGrokPlanUsageDetails(u, id);
		expect(lines[0]).toBe("Grok plan Super Grok Pro");
		expect(lines).toContain("Credits");
		expect(lines.some((line) => line.includes("42%"))).toBe(true);
		expect(lines.some((line) => line.startsWith("Period") && /weekly/i.test(line))).toBe(true);
		expect(lines.some((line) => line.startsWith("Prepaid") && line.includes("$12.50"))).toBe(true);
		expect(lines.some((line) => line.startsWith("On-demand") && line.includes("$1.00") && line.includes("$5.00"))).toBe(
			true,
		);
		expect(lines).toContain("Unified billing pool");
	});

	it("shows a warning when no usable data is present", () => {
		const u = parseGrokPlanUsage({}, NOW);
		expect(renderGrokPlanUsageDetails(u, id)).toEqual(["No Grok plan usage data available."]);
	});
});
