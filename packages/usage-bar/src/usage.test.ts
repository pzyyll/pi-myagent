import { describe, it, expect } from "bun:test";
import {
	parseCodexPlanUsage,
	parseCodexUsage,
	renderCodexPlanUsageDetails,
	renderCodexUsage,
	type ThemeColorName,
} from "./usage";

const NOW = 1_700_000_000_000;
const id = (_c: string, t: string) => t;

function window(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		used_percent: 50,
		limit_window_seconds: 18_000,
		reset_after_seconds: 7_200,
		...overrides,
	};
}

function payload(rateLimit: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown {
	return { rate_limit: rateLimit, ...extra };
}

describe("parseCodexUsage", () => {
	it("parses a five-hour-only payload into one 5h segment", () => {
		const u = parseCodexUsage(payload({ primary_window: window({ used_percent: 38 }) }), NOW);
		expect(u.usable).toBe(true);
		expect(u.windows).toHaveLength(1);
		expect(u.windows[0]!.label).toBe("5h");
		expect(u.windows[0]!.usedPercent).toBe(38);
	});

	it("parses a weekly-only payload into one W segment", () => {
		const u = parseCodexUsage(
			payload({ secondary_window: window({ used_percent: 75, limit_window_seconds: 604_800 }) }),
			NOW,
		);
		expect(u.usable).toBe(true);
		expect(u.windows).toHaveLength(1);
		expect(u.windows[0]!.label).toBe("W");
		expect(u.windows[0]!.usedPercent).toBe(75);
	});

	it("parses both windows in primary/secondary order", () => {
		const u = parseCodexUsage(
			payload({
				primary_window: window({ used_percent: 38 }),
				secondary_window: window({ used_percent: 75, limit_window_seconds: 604_800 }),
			}),
			NOW,
		);
		expect(u.windows).toHaveLength(2);
		expect(u.windows[0]!.label).toBe("5h");
		expect(u.windows[1]!.label).toBe("W");
	});

	it("labels a weekly-duration primary window as W, not 5h", () => {
		const u = parseCodexUsage(
			payload({ primary_window: window({ used_percent: 60, limit_window_seconds: 604_800 }) }),
			NOW,
		);
		expect(u.windows).toHaveLength(1);
		expect(u.windows[0]!.label).toBe("W");
	});

	it("is unusable when no valid window remains", () => {
		expect(parseCodexUsage({}, NOW).usable).toBe(false);
		expect(parseCodexUsage(payload({ primary_window: null, secondary_window: null }), NOW).usable).toBe(false);
		expect(
			parseCodexUsage(payload({ primary_window: { used_percent: "x", limit_window_seconds: 18_000 } }), NOW).usable,
		).toBe(false);
	});

	it("clamps out-of-range percentages to 0 and 100", () => {
		const low = parseCodexUsage(payload({ primary_window: window({ used_percent: -5 }) }), NOW);
		expect(low.windows[0]!.usedPercent).toBe(0);
		const high = parseCodexUsage(payload({ primary_window: window({ used_percent: 150 }) }), NOW);
		expect(high.windows[0]!.usedPercent).toBe(100);
	});

	it("prefers reset_at over reset_after_seconds", () => {
		const u = parseCodexUsage(
			payload({
				primary_window: window({
					used_percent: 50,
					limit_window_seconds: 18_000,
					reset_at: NOW / 1_000 + 3_600,
					reset_after_seconds: 7_200,
				}),
			}),
			NOW,
		);
		expect(u.windows[0]!.resetsIn).toBe("1h");
	});

	it("falls back to reset_after_seconds when reset_at is absent", () => {
		const u = parseCodexUsage(
			payload({ primary_window: window({ used_percent: 50, limit_window_seconds: 18_000, reset_after_seconds: 900 }) }),
			NOW,
		);
		expect(u.windows[0]!.resetsIn).toBe("15m");
	});

	it("renders past reset times as due", () => {
		const u = parseCodexUsage(
			payload({
				primary_window: window({ used_percent: 50, limit_window_seconds: 18_000, reset_at: NOW / 1_000 - 100 }),
			}),
			NOW,
		);
		expect(u.windows[0]!.resetsIn).toBe("due");
	});
});

describe("parseCodexPlanUsage", () => {
	it("parses plan type, windows, credits, monthly limit, and additional limits", () => {
		const u = parseCodexPlanUsage(
			{
				plan_type: "pro",
				rate_limit: {
					allowed: true,
					limit_reached: false,
					primary_window: window({ used_percent: 42, reset_after_seconds: 120 }),
					secondary_window: window({
						used_percent: 5,
						limit_window_seconds: 604_800,
						reset_after_seconds: 43_200,
					}),
				},
				credits: { has_credits: true, unlimited: false, balance: "9.99" },
				spend_control: {
					reached: false,
					individual_limit: {
						limit: "25000",
						used: "8000",
						remaining: "17000",
						used_percent: 32,
						remaining_percent: 68,
						reset_after_seconds: 43_200,
					},
				},
				additional_rate_limits: [
					{
						limit_name: "codex_other",
						metered_feature: "codex_other",
						rate_limit: {
							allowed: true,
							limit_reached: false,
							primary_window: window({
								used_percent: 88,
								limit_window_seconds: 1_800,
								reset_after_seconds: 600,
							}),
						},
					},
				],
				rate_limit_reached_type: { type: "workspace_member_usage_limit_reached" },
				rate_limit_reset_credits: { available_count: 3 },
			},
			NOW,
		);

		expect(u.usable).toBe(true);
		expect(u.planType).toBe("pro");
		expect(u.allowed).toBe(true);
		expect(u.limitReached).toBe(false);
		expect(u.windows).toHaveLength(2);
		expect(u.windows[0]!.label).toBe("5h");
		expect(u.windows[0]!.usedPercent).toBe(42);
		expect(u.windows[1]!.label).toBe("W");
		expect(u.credits).toEqual({ hasCredits: true, unlimited: false, balance: "9.99" });
		expect(u.monthlyLimit?.usedPercent).toBe(32);
		expect(u.monthlyLimit?.used).toBe("8000");
		expect(u.monthlyLimit?.limit).toBe("25000");
		expect(u.monthlyLimit?.resetsIn).toBe("12h");
		expect(u.additional).toHaveLength(1);
		expect(u.additional[0]!.name).toBe("codex_other");
		expect(u.additional[0]!.windows[0]!.usedPercent).toBe(88);
		expect(u.rateLimitReachedType).toBe("workspace_member_usage_limit_reached");
		expect(u.resetCreditsAvailable).toBe(3);
	});

	it("is usable when only plan_type is present", () => {
		const u = parseCodexPlanUsage({ plan_type: "plus" }, NOW);
		expect(u.usable).toBe(true);
		expect(u.planType).toBe("plus");
		expect(u.windows).toHaveLength(0);
		expect(parseCodexUsage({ plan_type: "plus" }, NOW).usable).toBe(false);
	});

	it("treats unlimited credits as displayable without balance", () => {
		const u = parseCodexPlanUsage(
			{
				plan_type: "pro",
				credits: { has_credits: true, unlimited: true },
			},
			NOW,
		);
		expect(u.credits).toEqual({ hasCredits: true, unlimited: true, balance: undefined });
	});
});

describe("renderCodexUsage", () => {
	it("renders both windows with bars, percentages, and reset text", () => {
		const u = parseCodexUsage(
			payload({
				primary_window: window({ used_percent: 38, limit_window_seconds: 18_000, reset_after_seconds: 7_200 }),
				secondary_window: window({ used_percent: 75, limit_window_seconds: 604_800, reset_after_seconds: 432_000 }),
			}),
			NOW,
		);
		expect(renderCodexUsage(u, id)).toBe("Codex 5h ███░░░░░ 38% ⟳ 2h  W ██████░░ 75% ⟳ 5d");
	});

	it("omits reset text when no reset time is available", () => {
		const u = parseCodexUsage(payload({ primary_window: { used_percent: 10, limit_window_seconds: 18_000 } }), NOW);
		const out = renderCodexUsage(u, id);
		expect(out).toContain("10%");
		expect(out).not.toContain("⟳");
	});

	it("renders the Codex prefix with the accent color", () => {
		const u = parseCodexUsage(
			payload({
				primary_window: window({ used_percent: 38, limit_window_seconds: 18_000, reset_after_seconds: 7_200 }),
				secondary_window: window({ used_percent: 75, limit_window_seconds: 604_800, reset_after_seconds: 432_000 }),
			}),
			NOW,
		);
		const calls: Array<{ color: ThemeColorName; text: string }> = [];
		const trackingFg = (color: ThemeColorName, text: string): string => {
			calls.push({ color, text });
			return text;
		};
		const out = renderCodexUsage(u, trackingFg);
		expect(out.startsWith("Codex ")).toBe(true);
		const codexCalls = calls.filter((c) => c.text === "Codex");
		expect(codexCalls).toHaveLength(1);
		expect(codexCalls[0]!.color).toBe("accent");
	});

	it("wraps only the Codex prefix in accent, keeping window label/bar/percent/reset colors unchanged", () => {
		const u = parseCodexUsage(
			payload({
				primary_window: window({ used_percent: 38, limit_window_seconds: 18_000, reset_after_seconds: 7_200 }),
				secondary_window: window({ used_percent: 75, limit_window_seconds: 604_800, reset_after_seconds: 432_000 }),
			}),
			NOW,
		);
		const marker = (color: ThemeColorName, text: string) => `<${color}>${text}</${color}>`;
		expect(renderCodexUsage(u, marker)).toBe(
			"<accent>Codex</accent> <dim>5h</dim> <success>███░░░░░</success> <success>38%</success> <dim>⟳ 2h</dim>  <dim>W</dim> <warning>██████░░</warning> <warning>75%</warning> <dim>⟳ 5d</dim>",
		);
	});

	it("keeps the identity renderer output as plain text with no color markers", () => {
		const u = parseCodexUsage(
			payload({
				primary_window: window({ used_percent: 38, limit_window_seconds: 18_000, reset_after_seconds: 7_200 }),
				secondary_window: window({ used_percent: 75, limit_window_seconds: 604_800, reset_after_seconds: 432_000 }),
			}),
			NOW,
		);
		expect(renderCodexUsage(u, id)).toBe("Codex 5h ███░░░░░ 38% ⟳ 2h  W ██████░░ 75% ⟳ 5d");
	});
});

describe("renderCodexPlanUsageDetails", () => {
	it("renders a multi-line plan detail view with windows, credits, and monthly limit", () => {
		const u = parseCodexPlanUsage(
			{
				plan_type: "pro",
				rate_limit: {
					primary_window: window({ used_percent: 38, reset_after_seconds: 7_200 }),
					secondary_window: window({
						used_percent: 75,
						limit_window_seconds: 604_800,
						reset_after_seconds: 432_000,
					}),
				},
				credits: { has_credits: true, unlimited: false, balance: "10" },
				spend_control: {
					individual_limit: {
						limit: "25000",
						used: "8000",
						remaining: "17000",
						used_percent: 32,
						reset_after_seconds: 43_200,
					},
				},
				rate_limit_reset_credits: { available_count: 2 },
			},
			NOW,
		);

		const lines = renderCodexPlanUsageDetails(u, id);
		expect(lines[0]).toBe("Codex plan Pro");
		expect(lines).toContain("Rate limits");
		expect(lines.some((line) => line.includes("5h") && line.includes("38%"))).toBe(true);
		expect(lines.some((line) => line.includes("W") && line.includes("75%"))).toBe(true);
		expect(lines).toContain("Credits  10 credits");
		expect(
			lines.some((line) => line.startsWith("Monthly") && line.includes("32%") && line.includes("8,000 / 25,000")),
		).toBe(true);
		expect(lines).toContain("Reset credits  2 available");
	});

	it("formats prolite as Pro Lite", () => {
		const u = parseCodexPlanUsage({ plan_type: "prolite" }, NOW);
		expect(renderCodexPlanUsageDetails(u, id)[0]).toBe("Codex plan Pro Lite");
	});
});
