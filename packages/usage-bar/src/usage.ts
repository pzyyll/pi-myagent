// ABOUTME: Pure Codex usage parser and renderer for the rate-limit status payload.
// ABOUTME: Handles primary/secondary windows independently and formats compact bars.
export type ThemeColorName = "success" | "error" | "warning" | "muted" | "dim" | "text" | "accent";

export type ThemeFg = (color: ThemeColorName, text: string) => string;

export interface CodexUsageWindow {
	readonly usedPercent: number; // clamped to 0..100
	readonly label: string;
	readonly resetsIn: string | undefined;
}

export interface CodexUsage {
	readonly windows: readonly CodexUsageWindow[];
	readonly usable: boolean;
}

const FIVE_HOURS_SECONDS = 5 * 60 * 60; // 18000
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60; // 604800
const DURATION_TOLERANCE_SECONDS = 60;
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_MINUTE = 60;
const BAR_WIDTH = 8;

export function parseCodexUsage(raw: unknown, now: number): CodexUsage {
	const root = pickObject(raw, "data") ?? (isPlainObject(raw) ? (raw as Record<string, unknown>) : undefined);
	const rateLimit = pickObject(root, "rate_limit");
	const primary = parseWindow(pickObject(rateLimit, "primary_window"), now, "5h");
	const secondary = parseWindow(pickObject(rateLimit, "secondary_window"), now, "W");

	if (primary && secondary) return { windows: [primary, secondary], usable: true };
	if (primary) return { windows: [primary], usable: true };
	if (secondary) return { windows: [secondary], usable: true };
	return { windows: [], usable: false };
}

export function renderCodexUsage(usage: CodexUsage, fg: ThemeFg): string {
	const parts = usage.windows.map((w) => renderWindow(w, fg)).filter((s) => s.length > 0);
	if (parts.length === 0) return "";
	return `${fg("accent", "Codex")} ${parts.join("  ")}`;
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

function formatRemaining(ms: number): string | undefined {
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

function renderWindow(w: CodexUsageWindow, fg: ThemeFg): string {
	const filled = Math.round((w.usedPercent / 100) * BAR_WIDTH);
	const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
	const percentColor: ThemeColorName = w.usedPercent >= 90 ? "error" : w.usedPercent >= 70 ? "warning" : "success";
	const percentText = fg(percentColor, `${Math.round(w.usedPercent)}%`);
	const labelText = fg("dim", w.label);
	const resetText = w.resetsIn ? ` ${fg("dim", `⟳ ${w.resetsIn}`)}` : "";
	return `${labelText} ${fg(percentColor, bar)} ${percentText}${resetText}`;
}

function pickObject(value: unknown, key: string): Record<string, unknown> | undefined {
	const obj = isPlainObject(value) ? (value as Record<string, unknown>) : undefined;
	if (!obj) return undefined;
	const inner = obj[key];
	return isPlainObject(inner) ? (inner as Record<string, unknown>) : undefined;
}

function isPlainObject(value: unknown): boolean {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}
