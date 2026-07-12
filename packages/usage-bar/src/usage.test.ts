import { describe, it, expect } from "bun:test";
import { parseCodexUsage, renderCodexUsage, type ThemeColorName } from "./usage";

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

function payload(rateLimit: Record<string, unknown>): unknown {
	return { rate_limit: rateLimit };
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
