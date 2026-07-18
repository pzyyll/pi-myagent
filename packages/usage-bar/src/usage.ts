// ABOUTME: Pure Codex usage parser and renderer for the rate-limit status payload.
// ABOUTME: Handles primary/secondary windows independently and formats compact bars.
import {
  BAR_WIDTH,
  DETAIL_BAR_WIDTH,
  clampPercent,
  formatRemaining,
  formatSnakeCase,
  isFiniteNumber,
  isPlainObject,
  percentThemeColor,
  pickObject,
  renderBrandUsage,
  renderWindow,
  type ThemeColorName,
  type ThemeFg,
  type UsageWindow,
} from "./shared";

export type { ThemeColorName, ThemeFg };
export type CodexUsageWindow = UsageWindow;

export interface CodexUsage {
  readonly windows: readonly CodexUsageWindow[];
  readonly usable: boolean;
}

export interface CodexCredits {
  readonly hasCredits: boolean;
  readonly unlimited: boolean;
  readonly balance: string | undefined;
}

export interface CodexMonthlyLimit {
  readonly usedPercent: number;
  readonly used: string;
  readonly limit: string;
  readonly remaining: string;
  readonly resetsIn: string | undefined;
}

export interface CodexAdditionalLimit {
  readonly name: string;
  readonly windows: readonly CodexUsageWindow[];
}

export interface CodexPlanUsage {
  readonly planType: string | undefined;
  readonly windows: readonly CodexUsageWindow[];
  readonly credits: CodexCredits | undefined;
  readonly monthlyLimit: CodexMonthlyLimit | undefined;
  readonly additional: readonly CodexAdditionalLimit[];
  readonly allowed: boolean | undefined;
  readonly limitReached: boolean | undefined;
  readonly rateLimitReachedType: string | undefined;
  readonly resetCreditsAvailable: number | undefined;
  readonly usable: boolean;
}

const FIVE_HOURS_SECONDS = 5 * 60 * 60; // 18000
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60; // 604800
const DURATION_TOLERANCE_SECONDS = 60;
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_MINUTE = 60;

export function parseCodexUsage(raw: unknown, now: number): CodexUsage {
  const plan = parseCodexPlanUsage(raw, now);
  return { windows: plan.windows, usable: plan.windows.length > 0 };
}

export function parseCodexPlanUsage(raw: unknown, now: number): CodexPlanUsage {
  const root = pickObject(raw, "data") ?? (isPlainObject(raw) ? raw : undefined);
  const planType = parsePlanType(root?.["plan_type"]);
  const rateLimit = pickObject(root, "rate_limit");
  const windows = parseRateLimitWindows(rateLimit, now);
  const credits = parseCredits(pickObject(root, "credits"));
  const monthlyLimit = parseMonthlyLimit(pickObject(root, "spend_control"), now);
  const additional = parseAdditionalLimits(root?.["additional_rate_limits"], now);
  const allowed = typeof rateLimit?.["allowed"] === "boolean" ? rateLimit["allowed"] : undefined;
  const limitReached = typeof rateLimit?.["limit_reached"] === "boolean" ? rateLimit["limit_reached"] : undefined;
  const rateLimitReachedType = parseReachedType(root?.["rate_limit_reached_type"]);
  const resetCredits = pickObject(root, "rate_limit_reset_credits");
  const resetCreditsAvailable = isFiniteNumber(resetCredits?.["available_count"])
    ? Math.max(0, Math.floor(resetCredits["available_count"]))
    : undefined;

  const usable =
    planType !== undefined ||
    windows.length > 0 ||
    credits !== undefined ||
    monthlyLimit !== undefined ||
    additional.length > 0 ||
    resetCreditsAvailable !== undefined;

  return {
    planType,
    windows,
    credits,
    monthlyLimit,
    additional,
    allowed,
    limitReached,
    rateLimitReachedType,
    resetCreditsAvailable,
    usable,
  };
}

export function renderCodexUsage(usage: CodexUsage, fg: ThemeFg): string {
  return renderBrandUsage("Codex", usage.windows, fg, BAR_WIDTH);
}

export function renderCodexPlanUsageDetails(usage: CodexPlanUsage, fg: ThemeFg): string[] {
  if (!usage.usable) return [fg("warning", "No Codex plan usage data available.")];

  const lines: string[] = [];
  const title = usage.planType
    ? `${fg("accent", "Codex")} ${fg("text", "plan")} ${fg("muted", formatPlanType(usage.planType))}`
    : `${fg("accent", "Codex")} ${fg("text", "plan usage")}`;
  lines.push(title);

  if (usage.allowed === false || usage.limitReached === true) {
    const flags: string[] = [];
    if (usage.allowed === false) flags.push("not allowed");
    if (usage.limitReached === true) flags.push("limit reached");
    lines.push(fg("warning", `Status: ${flags.join(", ")}`));
  }
  if (usage.rateLimitReachedType) {
    lines.push(fg("warning", `Reached: ${formatSnakeCase(usage.rateLimitReachedType)}`));
  }

  if (usage.windows.length > 0) {
    lines.push(fg("muted", "Rate limits"));
    for (const window of usage.windows) {
      lines.push(`  ${renderWindow(window, fg, DETAIL_BAR_WIDTH)}`);
    }
  }

  if (usage.credits) {
    lines.push(`${fg("muted", "Credits")}  ${renderCredits(usage.credits, fg)}`);
  }

  if (usage.monthlyLimit) {
    lines.push(`${fg("muted", "Monthly")}  ${renderMonthlyLimit(usage.monthlyLimit, fg)}`);
  }

  if (usage.resetCreditsAvailable !== undefined) {
    lines.push(`${fg("muted", "Reset credits")}  ${fg("text", String(usage.resetCreditsAvailable))} available`);
  }

  for (const extra of usage.additional) {
    lines.push(fg("muted", extra.name));
    if (extra.windows.length === 0) {
      lines.push(`  ${fg("dim", "no window data")}`);
      continue;
    }
    for (const window of extra.windows) {
      lines.push(`  ${renderWindow(window, fg, DETAIL_BAR_WIDTH)}`);
    }
  }

  return lines;
}

function parseRateLimitWindows(rateLimit: Record<string, unknown> | undefined, now: number): CodexUsageWindow[] {
  const primary = parseWindow(pickObject(rateLimit, "primary_window"), now, "5h");
  const secondary = parseWindow(pickObject(rateLimit, "secondary_window"), now, "W");
  const windows: CodexUsageWindow[] = [];
  if (primary) windows.push(primary);
  if (secondary) windows.push(secondary);
  return windows;
}

function parseWindow(
  value: Record<string, unknown> | undefined,
  now: number,
  fallbackLabel: string,
): CodexUsageWindow | undefined {
  if (!value) return undefined;
  const usedRaw = value["used_percent"];
  if (!isFiniteNumber(usedRaw)) return undefined;
  const usedPercent = clampPercent(usedRaw);
  const seconds = isFiniteNumber(value["limit_window_seconds"]) ? value["limit_window_seconds"] : undefined;
  const label = windowLabel(seconds, fallbackLabel);
  const resetsIn = parseResetsIn(value, now);
  return { usedPercent, label, resetsIn };
}

function parsePlanType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseCredits(value: Record<string, unknown> | undefined): CodexCredits | undefined {
  if (!value) return undefined;
  if (typeof value["has_credits"] !== "boolean" || typeof value["unlimited"] !== "boolean") return undefined;
  const balanceRaw = value["balance"];
  const balance =
    typeof balanceRaw === "string"
      ? balanceRaw
      : balanceRaw === null || balanceRaw === undefined
        ? undefined
        : typeof balanceRaw === "number" && Number.isFinite(balanceRaw)
          ? String(balanceRaw)
          : undefined;
  if (!value["has_credits"] && !value["unlimited"] && balance === undefined) return undefined;
  return {
    hasCredits: value["has_credits"],
    unlimited: value["unlimited"],
    balance,
  };
}

function parseMonthlyLimit(
  spendControl: Record<string, unknown> | undefined,
  now: number,
): CodexMonthlyLimit | undefined {
  const individual = pickObject(spendControl, "individual_limit");
  if (!individual) return undefined;
  const used = typeof individual["used"] === "string" ? individual["used"] : undefined;
  const limit = typeof individual["limit"] === "string" ? individual["limit"] : undefined;
  const remaining = typeof individual["remaining"] === "string" ? individual["remaining"] : undefined;
  const usedPercentRaw = individual["used_percent"];
  const remainingPercentRaw = individual["remaining_percent"];
  let usedPercent: number | undefined;
  if (isFiniteNumber(usedPercentRaw)) {
    usedPercent = clampPercent(usedPercentRaw);
  } else if (isFiniteNumber(remainingPercentRaw)) {
    usedPercent = clampPercent(100 - remainingPercentRaw);
  }
  if (usedPercent === undefined || used === undefined || limit === undefined || remaining === undefined) {
    return undefined;
  }
  return {
    usedPercent,
    used,
    limit,
    remaining,
    resetsIn: parseResetsIn(individual, now),
  };
}

function parseAdditionalLimits(value: unknown, now: number): CodexAdditionalLimit[] {
  if (!Array.isArray(value)) return [];
  const out: CodexAdditionalLimit[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const nameRaw = item["limit_name"] ?? item["metered_feature"];
    if (typeof nameRaw !== "string" || nameRaw.trim().length === 0) continue;
    const windows = parseRateLimitWindows(pickObject(item, "rate_limit"), now);
    out.push({ name: nameRaw.trim(), windows });
  }
  return out;
}

function parseReachedType(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  const obj = isPlainObject(value) ? value : undefined;
  if (!obj) return undefined;
  const kind = obj["type"] ?? obj["kind"];
  return typeof kind === "string" && kind.trim() ? kind.trim() : undefined;
}

function windowLabel(seconds: number | undefined, fallback: string): string {
  if (seconds === undefined || seconds <= 0) return fallback;
  if (Math.abs(seconds - FIVE_HOURS_SECONDS) <= DURATION_TOLERANCE_SECONDS) return "5h";
  if (Math.abs(seconds - SEVEN_DAYS_SECONDS) <= DURATION_TOLERANCE_SECONDS) return "W";
  return compactDuration(seconds);
}

function compactDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  const days = Math.floor(total / SECONDS_PER_DAY);
  const hours = Math.floor((total % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.ceil((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function parseResetsIn(obj: Record<string, unknown>, now: number): string | undefined {
  const resetAt = obj["reset_at"];
  let deadlineMs: number | undefined;
  if (isFiniteNumber(resetAt)) {
    deadlineMs = resetAt * 1_000;
  } else {
    const resetAfter = obj["reset_after_seconds"];
    if (isFiniteNumber(resetAfter) && resetAfter >= 0) {
      deadlineMs = now + resetAfter * 1_000;
    }
  }
  if (deadlineMs === undefined || !Number.isFinite(deadlineMs)) return undefined;
  return formatRemaining(deadlineMs - now);
}

function renderCredits(credits: CodexCredits, fg: ThemeFg): string {
  if (credits.unlimited) return fg("success", "Unlimited");
  if (!credits.hasCredits) return fg("dim", "none");
  if (credits.balance) return fg("text", `${formatAmount(credits.balance)} credits`);
  return fg("text", "available");
}

function renderMonthlyLimit(limit: CodexMonthlyLimit, fg: ThemeFg): string {
  const percentColor = percentThemeColor(limit.usedPercent);
  const filled = Math.round((limit.usedPercent / 100) * DETAIL_BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(DETAIL_BAR_WIDTH - filled);
  const amount = `${formatAmount(limit.used)} / ${formatAmount(limit.limit)}`;
  const resetText = limit.resetsIn ? ` ${fg("dim", `⟳ ${limit.resetsIn}`)}` : "";
  return `${fg(percentColor, bar)} ${fg(percentColor, `${Math.round(limit.usedPercent)}%`)} ${fg("dim", amount)}${resetText}`;
}

function formatPlanType(value: string): string {
  if (value.toLowerCase() === "prolite") return "Pro Lite";
  return formatSnakeCase(value);
}

function formatAmount(raw: string): string {
  const trimmed = raw.trim();
  const asNumber = Number(trimmed);
  if (!Number.isFinite(asNumber)) return trimmed;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(asNumber);
}
