// ABOUTME: Pure SuperGrok billing parser/renderer for cli-chat-proxy credits payloads.
// ABOUTME: Maps GetGrokCreditsConfig JSON (incl. productUsage) into footer and /usages details.
import {
	BAR_WIDTH,
	DETAIL_BAR_WIDTH,
	clampPercent,
	formatCentsUsd,
	formatRemaining,
	formatSnakeCase,
	isFiniteNumber,
	isPlainObject,
	percentThemeColor,
	pickObject,
	renderBrandUsage,
	renderWindow,
	type ThemeFg,
	type UsageWindow,
} from "./shared";

export interface GrokProductUsage {
	/** Display label, e.g. Build / API / Chat. */
	readonly label: string;
	/** Raw product enum if present, e.g. PRODUCT_GROK_BUILD. */
	readonly product: string | undefined;
	/** Share of the pooled allowance used by this product (0–100). */
	readonly usagePct: number;
}

export interface GrokPlanUsage {
	readonly subscriptionTier: string | undefined;
	readonly usagePct: number;
	readonly effectiveUsagePct: number;
	readonly periodType: string | undefined;
	readonly periodEndDisplay: string | undefined;
	readonly payAsYouGo: boolean;
	readonly onDemandEnabled: boolean | undefined;
	readonly onDemandCapCents: number | undefined;
	readonly onDemandUsedCents: number | undefined;
	readonly prepaidBalanceCents: number | undefined;
	readonly isUnifiedBillingUser: boolean | undefined;
	readonly productUsage: readonly GrokProductUsage[];
	readonly windows: readonly UsageWindow[];
	readonly usable: boolean;
}

export function parseGrokPlanUsage(raw: unknown, now: number): GrokPlanUsage {
	const root = isPlainObject(raw) ? raw : undefined;
	const config = pickObject(root, "config") ?? root;
	const subscriptionTier = firstString(
		root?.["subscriptionTier"] ?? root?.["subscription_tier"] ?? config?.["subscriptionTier"],
	);
	const onDemandEnabled = typeof root?.["onDemandEnabled"] === "boolean" ? root["onDemandEnabled"] : undefined;

	const creditPctRaw = config?.["creditUsagePercent"] ?? config?.["credit_usage_percent"];
	const monthlyLimit = centVal(config?.["monthlyLimit"] ?? config?.["monthly_limit"]);
	const used = centVal(config?.["used"]);
	const hasCreditPct = isFiniteNumber(creditPctRaw);
	const usagePct = hasCreditPct
		? clampPercent(creditPctRaw)
		: monthlyLimit !== undefined && monthlyLimit > 0 && used !== undefined
			? clampPercent((used / monthlyLimit) * 100)
			: 0;

	const currentPeriod = pickObject(config, "currentPeriod") ?? pickObject(config, "current_period");
	const periodTypeRaw =
		firstString(currentPeriod?.["type"] ?? currentPeriod?.["period_type"] ?? currentPeriod?.["periodType"]) ??
		undefined;
	const periodEndIso =
		firstString(currentPeriod?.["end"]) ?? firstString(config?.["billingPeriodEnd"] ?? config?.["billing_period_end"]);
	const resetsIn = periodEndIso ? remainingFromIso(periodEndIso, now) : undefined;
	const periodEndDisplay = periodEndIso ? formatPeriodEnd(periodEndIso) : undefined;

	const onDemandCap = centVal(config?.["onDemandCap"] ?? config?.["on_demand_cap"]);
	const onDemandUsed = centVal(config?.["onDemandUsed"] ?? config?.["on_demand_used"]);
	const prepaidBalance = centVal(config?.["prepaidBalance"] ?? config?.["prepaid_balance"]);
	const payAsYouGo = (onDemandCap ?? 0) > 0;
	const onDemandUsedCents =
		onDemandUsed ?? (used !== undefined && monthlyLimit !== undefined ? Math.max(0, used - monthlyLimit) : undefined);

	let effectiveUsagePct = usagePct;
	if (payAsYouGo && onDemandCap && onDemandCap > 0) {
		if (usagePct >= 100 && onDemandUsedCents !== undefined) {
			effectiveUsagePct = clampPercent((onDemandUsedCents / onDemandCap) * 100);
		} else if (!hasCreditPct && monthlyLimit !== undefined && used !== undefined) {
			const totalBudget = monthlyLimit + onDemandCap;
			effectiveUsagePct = totalBudget > 0 ? clampPercent((used / totalBudget) * 100) : 0;
		}
	}

	const isUnifiedBillingUser =
		typeof config?.["isUnifiedBillingUser"] === "boolean"
			? config["isUnifiedBillingUser"]
			: typeof config?.["is_unified_billing_user"] === "boolean"
				? config["is_unified_billing_user"]
				: undefined;

	const productUsage = parseProductUsage(config?.["productUsage"] ?? config?.["product_usage"]);

	const windows: UsageWindow[] = [];
	if (hasCreditPct || (monthlyLimit !== undefined && used !== undefined) || prepaidBalance !== undefined) {
		windows.push({
			usedPercent: usagePct,
			label: periodLabel(periodTypeRaw),
			resetsIn,
		});
	}

	const usable =
		windows.length > 0 ||
		subscriptionTier !== undefined ||
		prepaidBalance !== undefined ||
		payAsYouGo ||
		onDemandEnabled !== undefined ||
		productUsage.length > 0;

	return {
		subscriptionTier,
		usagePct,
		effectiveUsagePct,
		periodType: periodTypeRaw,
		periodEndDisplay,
		payAsYouGo,
		onDemandEnabled,
		onDemandCapCents: onDemandCap,
		onDemandUsedCents,
		prepaidBalanceCents: prepaidBalance,
		isUnifiedBillingUser,
		productUsage,
		windows,
		usable,
	};
}

export function renderGrokUsage(usage: GrokPlanUsage, fg: ThemeFg): string {
	return renderBrandUsage("Grok", usage.windows, fg, BAR_WIDTH);
}

export function renderGrokPlanUsageDetails(usage: GrokPlanUsage, fg: ThemeFg): string[] {
	if (!usage.usable) return [fg("warning", "No Grok plan usage data available.")];

	const lines: string[] = [];
	const tier = usage.subscriptionTier ? formatTier(usage.subscriptionTier) : undefined;
	const title = tier
		? `${fg("accent", "Grok")} ${fg("text", "plan")} ${fg("muted", tier)}`
		: `${fg("accent", "Grok")} ${fg("text", "plan usage")}`;
	lines.push(title);

	if (usage.windows.length > 0) {
		lines.push(fg("muted", "Credits"));
		for (const window of usage.windows) {
			lines.push(`  ${renderWindow(window, fg, DETAIL_BAR_WIDTH)}`);
		}
	} else {
		lines.push(
			`${fg("muted", "Credits")}  ${fg(usage.usagePct >= 90 ? "error" : usage.usagePct >= 70 ? "warning" : "success", `${Math.round(usage.usagePct)}%`)}`,
		);
	}

	if (usage.periodType || usage.periodEndDisplay) {
		const periodBits: string[] = [];
		if (usage.periodType) periodBits.push(formatPeriodType(usage.periodType));
		if (usage.periodEndDisplay) periodBits.push(`ends ${usage.periodEndDisplay}`);
		lines.push(`${fg("muted", "Period")}  ${fg("text", periodBits.join(" · "))}`);
	}

	if (usage.prepaidBalanceCents !== undefined) {
		const prepaidColor = Math.abs(usage.prepaidBalanceCents) > 0 ? "text" : "dim";
		lines.push(`${fg("muted", "Prepaid")}  ${fg(prepaidColor, formatCentsUsd(usage.prepaidBalanceCents))}`);
	}

	if (usage.payAsYouGo || usage.onDemandEnabled === true) {
		const used = usage.onDemandUsedCents ?? 0;
		const cap = usage.onDemandCapCents;
		const amount = cap !== undefined ? `${formatCentsUsd(used)} / ${formatCentsUsd(cap)}` : formatCentsUsd(used);
		const enabledNote =
			usage.onDemandEnabled === false ? fg("dim", " (disabled)") : usage.onDemandEnabled === true ? "" : "";
		lines.push(`${fg("muted", "On-demand")}  ${fg("text", amount)}${enabledNote}`);
	} else if (usage.onDemandEnabled === false) {
		lines.push(`${fg("muted", "On-demand")}  ${fg("dim", "disabled")}`);
	}

	if (usage.productUsage.length > 0) {
		lines.push(fg("muted", "By product"));
		const labelWidth = Math.max(...usage.productUsage.map((p) => p.label.length), 4);
		for (const product of usage.productUsage) {
			const filled = Math.round((product.usagePct / 100) * DETAIL_BAR_WIDTH);
			const bar = "█".repeat(filled) + "░".repeat(DETAIL_BAR_WIDTH - filled);
			const pctColor = percentThemeColor(product.usagePct);
			const label = product.label.padEnd(labelWidth);
			lines.push(`  ${fg("dim", label)} ${fg(pctColor, bar)} ${fg(pctColor, `${Math.round(product.usagePct)}%`)}`);
		}
	}

	if (usage.isUnifiedBillingUser === true) {
		lines.push(fg("dim", "Unified billing pool"));
	}

	if (usage.payAsYouGo && usage.usagePct >= 100) {
		lines.push(
			`${fg("muted", "Effective")}  ${fg(usage.effectiveUsagePct >= 90 ? "error" : "warning", `${Math.round(usage.effectiveUsagePct)}%`)} on-demand`,
		);
	}

	return lines;
}

function centVal(value: unknown): number | undefined {
	if (isFiniteNumber(value)) return Math.trunc(value);
	if (!isPlainObject(value)) return undefined;
	const raw = value["val"] ?? value["value"];
	return isFiniteNumber(raw) ? Math.trunc(raw) : undefined;
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

function formatPeriodEnd(iso: string): string | undefined {
	const end = Date.parse(iso);
	if (!Number.isFinite(end)) return undefined;
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

function periodLabel(periodType: string | undefined): string {
	if (!periodType) return "Credits";
	const normalized = periodType.toUpperCase();
	if (normalized.includes("WEEK")) return "W";
	if (normalized.includes("MONTH")) return "M";
	if (normalized.includes("DAY")) return "D";
	return "Credits";
}

function formatPeriodType(periodType: string): string {
	const normalized = periodType.replace(/^USAGE_PERIOD_TYPE_/i, "").toLowerCase();
	return formatSnakeCase(normalized);
}

function formatTier(tier: string): string {
	// SuperGrokPro → Super Grok Pro; keep already spaced display names.
	if (/\s/.test(tier)) return tier;
	return tier
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/_/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function parseProductUsage(raw: unknown): GrokProductUsage[] {
	if (!Array.isArray(raw)) return [];
	const items: GrokProductUsage[] = [];
	for (const entry of raw) {
		if (!isPlainObject(entry)) continue;
		const pctRaw = entry["usagePercent"] ?? entry["usage_percent"];
		if (!isFiniteNumber(pctRaw)) continue;
		const product = firstString(entry["product"] ?? entry["product_type"] ?? entry["name"]);
		const label =
			firstString(entry["label"] ?? entry["displayName"] ?? entry["display_name"]) ?? formatProductLabel(product);
		if (!label) continue;
		items.push({
			label,
			product,
			usagePct: clampPercent(pctRaw),
		});
	}
	items.sort((a, b) => b.usagePct - a.usagePct || a.label.localeCompare(b.label));
	return items;
}

function formatProductLabel(product: string | undefined): string | undefined {
	if (!product) return undefined;
	const known: Record<string, string> = {
		PRODUCT_API: "API",
		PRODUCT_XAI_API: "API",
		PRODUCT_GROK_API: "API",
		PRODUCT_GROK_BUILD: "Build",
		PRODUCT_BUILD: "Build",
		PRODUCT_CHAT: "Chat",
		PRODUCT_GROK_CHAT: "Chat",
		PRODUCT_IMAGINE: "Imagine",
		PRODUCT_GROK_IMAGINE: "Imagine",
		PRODUCT_VOICE: "Voice",
		PRODUCT_GROK_VOICE: "Voice",
	};
	const upper = product.trim().toUpperCase();
	if (known[upper]) return known[upper];
	// PRODUCT_GROK_BUILD → Build; product_api → API
	const stripped = upper
		.replace(/^PRODUCT_/, "")
		.replace(/^GROK_/, "")
		.replace(/_/g, " ")
		.trim();
	if (!stripped) return undefined;
	return stripped
		.split(/\s+/)
		.map((part) => {
			if (part === "API") return "API";
			return part.charAt(0) + part.slice(1).toLowerCase();
		})
		.join(" ");
}
