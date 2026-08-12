// ABOUTME: Pure OpenCode Go usage parser and renderer for /zen/go/v1/usage.
// ABOUTME: Maps rolling/weekly/monthly windows into footer bars and /usages details.
import {
  BAR_WIDTH,
  DETAIL_BAR_WIDTH,
  clampPercent,
  formatRemaining,
  isFiniteNumber,
  isPlainObject,
  percentThemeColor,
  pickObject,
  renderBrandUsage,
  type ThemeFg,
  type UsageWindow,
} from "./shared";

export type OpenCodeGoWindowKey = "rolling" | "weekly" | "monthly";

export interface OpenCodeGoWindowDetail {
  readonly key: OpenCodeGoWindowKey;
  readonly label: string;
  readonly status: string | undefined;
  readonly usedPercent: number;
  readonly resetsIn: string | undefined;
  readonly resetsAt: string | undefined;
}

export interface OpenCodeGoPlanUsage {
  readonly windows: readonly UsageWindow[];
  readonly details: readonly OpenCodeGoWindowDetail[];
  readonly rateLimited: boolean;
  readonly usable: boolean;
}

const WINDOW_SPECS: readonly {
  readonly key: OpenCodeGoWindowKey;
  readonly label: string;
  readonly fullLabel: string;
}[] = [
  { key: "rolling", label: "5h", fullLabel: "5 hours" },
  { key: "weekly", label: "W", fullLabel: "Weekly" },
  { key: "monthly", label: "M", fullLabel: "Monthly" },
];

export function parseOpenCodeGoPlanUsage(raw: unknown, now: number): OpenCodeGoPlanUsage {
  const root = isPlainObject(raw) ? raw : undefined;
  const usage = pickObject(root, "usage") ?? root;

  const details: OpenCodeGoWindowDetail[] = [];
  for (const spec of WINDOW_SPECS) {
    const detail = parseWindowDetail(pickObject(usage, spec.key), spec.key, spec.label, now);
    if (detail) details.push(detail);
  }

  const windows: UsageWindow[] = details.map((detail) => ({
    usedPercent: detail.usedPercent,
    label: detail.label,
    resetsIn: detail.resetsIn,
  }));

  const rateLimited = details.some((detail) => isRateLimited(detail.status));
  const usable = details.length > 0;

  return { windows, details, rateLimited, usable };
}

export function renderOpenCodeGoUsage(usage: OpenCodeGoPlanUsage, fg: ThemeFg): string {
  return renderBrandUsage("Go", usage.windows, fg, BAR_WIDTH);
}

export function renderOpenCodeGoPlanUsageDetails(usage: OpenCodeGoPlanUsage, fg: ThemeFg): string[] {
  if (!usage.usable) return [fg("warning", "No OpenCode Go plan usage data available.")];

  const lines: string[] = [`${fg("accent", "OpenCode Go")} ${fg("text", "plan usage")}`];

  if (usage.details.length > 0) {
    lines.push(fg("muted", "Rate limits"));
    const labelWidth = Math.max(...usage.details.map((d) => fullLabel(d.key).length), "Monthly".length);
    for (const detail of usage.details) {
      lines.push(`  ${renderDetailWindow(detail, fg, labelWidth)}`);
    }
  }

  if (usage.rateLimited) {
    lines.push(fg("warning", "One or more windows are rate-limited."));
  }

  return lines;
}

function renderDetailWindow(detail: OpenCodeGoWindowDetail, fg: ThemeFg, labelWidth: number): string {
  const label = fullLabel(detail.key).padEnd(labelWidth);
  const filled = Math.round((detail.usedPercent / 100) * DETAIL_BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(DETAIL_BAR_WIDTH - filled);
  const percentColor = percentThemeColor(detail.usedPercent);
  const percentText = `${Math.round(detail.usedPercent)}%`.padStart(4);
  const resetText = detail.resetsIn ? ` ⟳ ${detail.resetsIn}` : "";
  const dateText = detail.resetsAt ? `  resets ${formatResetDate(detail.resetsAt)}` : "";
  const rateText = isRateLimited(detail.status) ? `  ${fg("error", "rate-limited")}` : "";
  return `${fg("dim", label)} ${fg(percentColor, bar)} ${fg(percentColor, percentText)}${fg("dim", resetText)}${fg("dim", dateText)}${rateText}`;
}

function fullLabel(key: OpenCodeGoWindowKey): string {
  return WINDOW_SPECS.find((spec) => spec.key === key)?.fullLabel ?? key;
}

function formatResetDate(iso: string): string {
  const end = Date.parse(iso);
  if (!Number.isFinite(end)) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(end));
  } catch {
    return iso;
  }
}

function parseWindowDetail(
  value: Record<string, unknown> | undefined,
  key: OpenCodeGoWindowKey,
  label: string,
  now: number,
): OpenCodeGoWindowDetail | undefined {
  if (!value) return undefined;

  const percentRaw = value["percent"] ?? value["usagePercent"] ?? value["usage_percent"];
  if (!isFiniteNumber(percentRaw)) return undefined;

  const status = firstString(value["status"]);
  const resetsAt = firstString(value["resetsAt"] ?? value["resets_at"]);
  const resetInSec = isFiniteNumber(value["resetInSec"])
    ? value["resetInSec"]
    : isFiniteNumber(value["reset_in_sec"])
      ? value["reset_in_sec"]
      : undefined;

  const resetsIn =
    resetsAt !== undefined
      ? remainingFromIso(resetsAt, now)
      : resetInSec !== undefined
        ? formatRemaining(resetInSec * 1_000)
        : undefined;

  return {
    key,
    label,
    status,
    usedPercent: clampPercent(percentRaw),
    resetsIn,
    resetsAt,
  };
}

function isRateLimited(status: string | undefined): boolean {
  if (!status) return false;
  return status.trim().toLowerCase() === "rate-limited";
}

function firstString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function remainingFromIso(iso: string, now: number): string | undefined {
  const end = Date.parse(iso);
  if (!Number.isFinite(end)) return undefined;
  return formatRemaining(end - now);
}
