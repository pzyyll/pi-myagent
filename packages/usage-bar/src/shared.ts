// ABOUTME: Shared usage-window types and compact bar rendering for all usage channels.
// ABOUTME: Keeps footer/detail bars visually consistent across Codex and Grok providers.
export type ThemeColorName = "success" | "error" | "warning" | "muted" | "dim" | "text" | "accent";

export type ThemeFg = (color: ThemeColorName, text: string) => string;

export interface UsageWindow {
  readonly usedPercent: number; // clamped to 0..100
  readonly label: string;
  readonly resetsIn: string | undefined;
}

export const BAR_WIDTH = 8;
export const DETAIL_BAR_WIDTH = 16;

const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_MINUTE = 60;

export function renderBrandUsage(
  brand: string,
  windows: readonly UsageWindow[],
  fg: ThemeFg,
  barWidth: number = BAR_WIDTH,
): string {
  const parts = windows.map((w) => renderWindow(w, fg, barWidth)).filter((s) => s.length > 0);
  if (parts.length === 0) return "";
  return `${fg("accent", brand)} ${parts.join("  ")}`;
}

export function renderWindow(w: UsageWindow, fg: ThemeFg, barWidth: number): string {
  const filled = Math.round((w.usedPercent / 100) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
  const percentColor: ThemeColorName = percentThemeColor(w.usedPercent);
  const percentText = fg(percentColor, `${Math.round(w.usedPercent)}%`);
  const labelText = fg("dim", w.label);
  const resetText = w.resetsIn ? ` ${fg("dim", `⟳ ${w.resetsIn}`)}` : "";
  return `${labelText} ${fg(percentColor, bar)} ${percentText}${resetText}`;
}

export function percentThemeColor(usedPercent: number): ThemeColorName {
  return usedPercent >= 90 ? "error" : usedPercent >= 70 ? "warning" : "success";
}

export function formatRemaining(ms: number): string | undefined {
  if (!Number.isFinite(ms)) return undefined;
  if (ms <= 0) return "due";
  const totalSeconds = Math.floor(ms / 1_000);
  const days = Math.floor(totalSeconds / SECONDS_PER_DAY);
  const hours = Math.floor((totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function pickObject(value: unknown, key: string): Record<string, unknown> | undefined {
  const obj = isPlainObject(value) ? value : undefined;
  if (!obj) return undefined;
  const inner = obj[key];
  return isPlainObject(inner) ? inner : undefined;
}

export function formatCentsUsd(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(dollars);
}

export function formatSnakeCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
