// ABOUTME: Tests OpenCode Go /zen/go/v1/usage parsing and footer/detail rendering.
// ABOUTME: Covers live payload shape, alternate field names, clamping, and rate-limit status.
import { describe, expect, it } from "bun:test";
import {
  parseOpenCodeGoPlanUsage,
  renderOpenCodeGoPlanUsageDetails,
  renderOpenCodeGoUsage,
} from "../src/opencode-go-usage";

const NOW = Date.parse("2026-08-12T10:00:00.000Z");
const id = (_c: string, t: string) => t;

function livePayload(
  overrides: {
    rolling?: Record<string, unknown>;
    weekly?: Record<string, unknown>;
    monthly?: Record<string, unknown>;
  } = {},
): unknown {
  return {
    usage: {
      rolling: {
        status: "ok",
        percent: 0,
        resetsAt: "2026-08-12T14:57:19.538Z",
        ...overrides.rolling,
      },
      weekly: {
        status: "ok",
        percent: 0,
        resetsAt: "2026-08-17T00:00:00.538Z",
        ...overrides.weekly,
      },
      monthly: {
        status: "ok",
        percent: 31,
        resetsAt: "2026-08-31T09:17:32.538Z",
        ...overrides.monthly,
      },
    },
  };
}

describe("parseOpenCodeGoPlanUsage", () => {
  it("parses the live nested usage payload into 5h/W/M windows", () => {
    const u = parseOpenCodeGoPlanUsage(livePayload(), NOW);
    expect(u.usable).toBe(true);
    expect(u.rateLimited).toBe(false);
    expect(u.windows).toHaveLength(3);
    expect(u.windows.map((w) => w.label)).toEqual(["5h", "W", "M"]);
    expect(u.windows[0]!.usedPercent).toBe(0);
    expect(u.windows[0]!.resetsIn).toBe("4h 57m");
    expect(u.windows[1]!.usedPercent).toBe(0);
    expect(u.windows[1]!.resetsIn).toBe("4d 14h");
    expect(u.windows[2]!.usedPercent).toBe(31);
    expect(u.windows[2]!.resetsIn).toBe("18d 23h");
    expect(u.details.map((d) => d.key)).toEqual(["rolling", "weekly", "monthly"]);
  });

  it("accepts alternate field names usagePercent and resetInSec", () => {
    const u = parseOpenCodeGoPlanUsage(
      {
        usage: {
          rolling: { usagePercent: 65.4, resetInSec: 2520, status: "ok" },
          weekly: { usage_percent: 30, reset_in_sec: 259_200 },
          monthly: { percent: 12, resets_at: "2026-08-31T09:17:32.538Z" },
        },
      },
      NOW,
    );
    expect(u.usable).toBe(true);
    expect(u.windows[0]!.usedPercent).toBe(65.4);
    expect(u.windows[0]!.resetsIn).toBe("42m");
    expect(u.windows[1]!.usedPercent).toBe(30);
    expect(u.windows[1]!.resetsIn).toBe("3d");
    expect(u.windows[2]!.usedPercent).toBe(12);
    expect(u.windows[2]!.resetsIn).toBe("18d 23h");
  });

  it("clamps out-of-range percentages", () => {
    const high = parseOpenCodeGoPlanUsage(livePayload({ rolling: { percent: 150 } }), NOW);
    expect(high.windows[0]!.usedPercent).toBe(100);
    const low = parseOpenCodeGoPlanUsage(livePayload({ weekly: { percent: -3 } }), NOW);
    expect(low.windows[1]!.usedPercent).toBe(0);
  });

  it("marks rate-limited windows", () => {
    const u = parseOpenCodeGoPlanUsage(livePayload({ rolling: { status: "rate-limited", percent: 100 } }), NOW);
    expect(u.rateLimited).toBe(true);
    expect(u.details[0]!.status).toBe("rate-limited");
  });

  it("is unusable for empty or non-object payloads", () => {
    expect(parseOpenCodeGoPlanUsage({}, NOW).usable).toBe(false);
    expect(parseOpenCodeGoPlanUsage(null, NOW).usable).toBe(false);
    expect(parseOpenCodeGoPlanUsage({ usage: {} }, NOW).usable).toBe(false);
  });

  it("skips windows without a finite percent", () => {
    const u = parseOpenCodeGoPlanUsage(
      {
        usage: {
          rolling: { status: "ok", resetsAt: "2026-08-12T14:57:19.538Z" },
          weekly: { status: "ok", percent: 10, resetsAt: "2026-08-17T00:00:00.538Z" },
        },
      },
      NOW,
    );
    expect(u.windows).toHaveLength(1);
    expect(u.windows[0]!.label).toBe("W");
  });
});

describe("renderOpenCodeGoUsage", () => {
  it("renders a compact Go footer with three windows", () => {
    const u = parseOpenCodeGoPlanUsage(livePayload(), NOW);
    const text = renderOpenCodeGoUsage(u, id);
    expect(text.startsWith("Go ")).toBe(true);
    expect(text).toContain("5h");
    expect(text).toContain("W");
    expect(text).toContain("M");
    expect(text).toContain("0%");
    expect(text).toContain("31%");
  });
});

describe("renderOpenCodeGoPlanUsageDetails", () => {
  it("renders aligned full-label windows with section header and reset dates", () => {
    const u = parseOpenCodeGoPlanUsage(livePayload(), NOW);
    const lines = renderOpenCodeGoPlanUsageDetails(u, id);
    expect(lines[0]).toContain("OpenCode Go");
    expect(lines[1]).toBe("Rate limits");
    expect(lines[2]).toContain("5 hours");
    expect(lines[2]).toContain("0%");
    expect(lines[2]).toContain("⟳ 4h 57m");
    expect(lines[2]).toContain("resets Aug 12");
    expect(lines[3]).toContain("Weekly");
    expect(lines[4]).toContain("Monthly");
    expect(lines[4]).toContain("31%");
    expect(lines[4]).toContain("resets Aug 31");
  });

  it("renders a detail panel with rate-limit notes", () => {
    const u = parseOpenCodeGoPlanUsage(livePayload({ monthly: { status: "rate-limited", percent: 100 } }), NOW);
    const lines = renderOpenCodeGoPlanUsageDetails(u, id);
    expect(lines[0]).toContain("OpenCode Go");
    expect(lines.some((line) => line.includes("rate-limited"))).toBe(true);
    expect(lines.some((line) => line.includes("One or more windows are rate-limited."))).toBe(true);
  });

  it("warns when no data is available", () => {
    const lines = renderOpenCodeGoPlanUsageDetails(parseOpenCodeGoPlanUsage({}, NOW), id);
    expect(lines).toEqual(["No OpenCode Go plan usage data available."]);
  });
});
