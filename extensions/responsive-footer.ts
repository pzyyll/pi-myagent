import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const USAGE_BARS_STATUS_KEYS = new Set(["usage-bars", "pi-usage-bars"]);

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

function charWidth(char: string): number {
	const codePoint = char.codePointAt(0) ?? 0;

	if (codePoint === 0) return 0;
	if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
	if (codePoint >= 0x300 && codePoint <= 0x36f) return 0;
	if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) return 0;
	if (codePoint === 0x200d) return 0;

	return codePoint >= 0x1100 &&
		(codePoint <= 0x115f ||
			codePoint === 0x2329 ||
			codePoint === 0x232a ||
			(codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
			(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
			(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
			(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
			(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
			(codePoint >= 0xff00 && codePoint <= 0xff60) ||
			(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
			(codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
			(codePoint >= 0x20000 && codePoint <= 0x3fffd))
		? 2
		: 1;
}

function visibleWidth(text: string): number {
	let width = 0;
	for (const char of Array.from(stripAnsi(text))) {
		width += charWidth(char);
	}
	return width;
}

function truncateToWidth(text: string, width: number, ellipsis = "..."): string {
	if (visibleWidth(text) <= width) return text;
	if (width <= 0) return "";

	const target = Math.max(0, width - visibleWidth(ellipsis));
	let output = "";
	let used = 0;

	for (let i = 0; i < text.length; ) {
		const ansi = text.slice(i).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
		if (ansi) {
			output += ansi[0];
			i += ansi[0].length;
			continue;
		}

		const char = Array.from(text.slice(i))[0];
		const charDisplayWidth = charWidth(char);
		if (used + charDisplayWidth > target) break;
		output += char;
		used += charDisplayWidth;
		i += char.length;
	}

	return output + ellipsis;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function wrapStatusItems(items: string[], width: number): string[] {
	if (width <= 0) return [];

	const lines: string[] = [];
	let line = "";
	let lineWidth = 0;

	const pushLine = () => {
		lines.push(line);
		line = "";
		lineWidth = 0;
	};

	const appendText = (text: string) => {
		for (let i = 0; i < text.length; ) {
			const ansi = text.slice(i).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
			if (ansi) {
				line += ansi[0];
				i += ansi[0].length;
				continue;
			}

			const char = Array.from(text.slice(i))[0];
			const nextWidth = charWidth(char);
			if (nextWidth > 0 && lineWidth > 0 && lineWidth + nextWidth > width) {
				pushLine();
			}

			line += char;
			lineWidth += nextWidth;
			i += char.length;
		}
	};

	for (const item of items) {
		if (!item) continue;

		const separator = lineWidth > 0 ? "  " : "";
		const itemWidth = visibleWidth(item);
		const separatorWidth = visibleWidth(separator);

		if (lineWidth > 0 && lineWidth + separatorWidth + itemWidth > width) {
			pushLine();
		} else if (separator) {
			appendText(separator);
		}

		appendText(item);
	}

	if (line || lines.length === 0) lines.push(line);
	return lines;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function renderDefaultFooterLines(ctx: any, theme: any, footerData: any, width: number): string[] {
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;
	let latestCacheHitRate: number | undefined;
	let thinkingLevel: string | undefined;

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			totalInput += entry.message.usage.input;
			totalOutput += entry.message.usage.output;
			totalCacheRead += entry.message.usage.cacheRead;
			totalCacheWrite += entry.message.usage.cacheWrite;
			totalCost += entry.message.usage.cost.total;

			const latestPromptTokens =
				entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
			latestCacheHitRate =
				latestPromptTokens > 0 ? (entry.message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
		} else if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
		}
	}

	let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);

	const branch = footerData.getGitBranch();
	if (branch) pwd = `${pwd} (${branch})`;

	const sessionName = ctx.sessionManager.getSessionName();
	if (sessionName) pwd = `${pwd} • ${sessionName}`;

	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextPercentValue = contextUsage?.percent ?? 0;
	const autoIndicator = ctx.session?.autoCompactionEnabled === false ? "" : " (auto)";
	const contextPercentDisplay =
		contextUsage?.percent === null
			? `?/${formatTokens(contextWindow)}${autoIndicator}`
			: `${contextPercentValue.toFixed(1)}%/${formatTokens(contextWindow)}${autoIndicator}`;

	let contextPercent = contextPercentDisplay;
	if (contextPercentValue > 90) contextPercent = theme.fg("error", contextPercentDisplay);
	else if (contextPercentValue > 70) contextPercent = theme.fg("warning", contextPercentDisplay);

	const modelName = ctx.model?.id || "no-model";
	let modelSide = modelName;
	if (ctx.model?.reasoning) {
		const displayedThinkingLevel = thinkingLevel || "off";
		modelSide =
			displayedThinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${displayedThinkingLevel}`;
	}

	if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
		modelSide = `(${ctx.model.provider}) ${modelSide}`;
	}

	const statsParts: string[] = [];
	if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
	if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
	if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
	if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
	if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) {
		statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
	}

	const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
	if (totalCost || usingSubscription) {
		statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
	}
	statsParts.push(contextPercent);

	let usageSide = statsParts.join(" ");
	if (visibleWidth(usageSide) > width) usageSide = truncateToWidth(usageSide, width, "...");

	let displayModelSide = modelSide;
	let footerLine = modelSide;
	const modelSideWidth = visibleWidth(modelSide);
	const usageSideWidth = visibleWidth(usageSide);

	if (modelSideWidth + 2 + usageSideWidth <= width) {
		footerLine = modelSide + " ".repeat(width - modelSideWidth - usageSideWidth) + usageSide;
	} else {
		const availableForUsage = width - modelSideWidth - 2;
		if (availableForUsage > 0) {
			const truncatedUsage = truncateToWidth(usageSide, availableForUsage, "...");
			footerLine =
				modelSide + " ".repeat(Math.max(2, width - modelSideWidth - visibleWidth(truncatedUsage))) + truncatedUsage;
		} else if (modelSideWidth > width) {
			displayModelSide = truncateToWidth(modelSide, width, "...");
			footerLine = displayModelSide;
		}
	}

	const dimModelSide = theme.fg("dim", displayModelSide);
	const dimRemainder = theme.fg("dim", footerLine.slice(displayModelSide.length));

	return [truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")), dimModelSide + dimRemainder];
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setFooter((_tui, theme, footerData) => ({
			invalidate() {},

			render(width: number): string[] {
				const lines = renderDefaultFooterLines(ctx, theme, footerData, width);
				const statusEntries = Array.from(footerData.getExtensionStatuses().entries()).sort(([a], [b]) =>
					a.localeCompare(b),
				);
				const usageBarsStatus = statusEntries.find(([key]) => USAGE_BARS_STATUS_KEYS.has(key))?.[1];

				if (usageBarsStatus) {
					lines.push(truncateToWidth(sanitizeStatusText(usageBarsStatus), width, "..."));
				}

				const statuses = statusEntries
					.filter(([key]) => !USAGE_BARS_STATUS_KEYS.has(key))
					.map(([, text]) => sanitizeStatusText(text));

				if (statuses.length > 0) {
					lines.push(...wrapStatusItems(statuses, width));
				}

				return lines;
			},
		}));
	});
}
