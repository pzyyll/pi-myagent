import type { ExtensionAPI, ExtensionContext, WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";

const SPINNER_VERBS = [
	"Accomplishing",
	"Actioning",
	"Actualizing",
	"Architecting",
	"Baking",
	"Beaming",
	"Beboppin'",
	"Befuddling",
	"Billowing",
	"Blanching",
	"Bloviating",
	"Boogieing",
	"Boondoggling",
	"Booping",
	"Bootstrapping",
	"Brewing",
	"Bunning",
	"Burrowing",
	"Calculating",
	"Canoodling",
	"Caramelizing",
	"Cascading",
	"Catapulting",
	"Cerebrating",
	"Channeling",
	"Channelling",
	"Choreographing",
	"Churning",
	"Clauding",
	"Coalescing",
	"Cogitating",
	"Combobulating",
	"Composing",
	"Computing",
	"Concocting",
	"Considering",
	"Contemplating",
	"Cooking",
	"Crafting",
	"Creating",
	"Crunching",
	"Crystallizing",
	"Cultivating",
	"Deciphering",
	"Deliberating",
	"Determining",
	"Dilly-dallying",
	"Discombobulating",
	"Doing",
	"Doodling",
	"Drizzling",
	"Ebbing",
	"Effecting",
	"Elucidating",
	"Embellishing",
	"Enchanting",
	"Envisioning",
	"Evaporating",
	"Fermenting",
	"Fiddle-faddling",
	"Finagling",
	"Flambéing",
	"Flibbertigibbeting",
	"Flowing",
	"Flummoxing",
	"Fluttering",
	"Forging",
	"Forming",
	"Frolicking",
	"Frosting",
	"Gallivanting",
	"Galloping",
	"Garnishing",
	"Generating",
	"Gesticulating",
	"Germinating",
	"Gitifying",
	"Grooving",
	"Gusting",
	"Harmonizing",
	"Hashing",
	"Hatching",
	"Herding",
	"Honking",
	"Hullaballooing",
	"Hyperspacing",
	"Ideating",
	"Imagining",
	"Improvising",
	"Incubating",
	"Inferring",
	"Infusing",
	"Ionizing",
	"Jitterbugging",
	"Julienning",
	"Kneading",
	"Leavening",
	"Levitating",
	"Lollygagging",
	"Manifesting",
	"Marinating",
	"Meandering",
	"Metamorphosing",
	"Misting",
	"Moonwalking",
	"Moseying",
	"Mulling",
	"Mustering",
	"Musing",
	"Nebulizing",
	"Nesting",
	"Newspapering",
	"Noodling",
	"Nucleating",
	"Orbiting",
	"Orchestrating",
	"Osmosing",
	"Perambulating",
	"Percolating",
	"Perusing",
	"Philosophising",
	"Photosynthesizing",
	"Pollinating",
	"Pondering",
	"Pontificating",
	"Pouncing",
	"Precipitating",
	"Prestidigitating",
	"Processing",
	"Proofing",
	"Propagating",
	"Puttering",
	"Puzzling",
	"Quantumizing",
	"Razzle-dazzling",
	"Razzmatazzing",
	"Recombobulating",
	"Reticulating",
	"Roosting",
	"Ruminating",
	"Sautéing",
	"Scampering",
	"Schlepping",
	"Scurrying",
	"Seasoning",
	"Shenaniganing",
	"Shimmying",
	"Simmering",
	"Skedaddling",
	"Sketching",
	"Slithering",
	"Smooshing",
	"Sock-hopping",
	"Spelunking",
	"Spinning",
	"Sprouting",
	"Stewing",
	"Sublimating",
	"Swirling",
	"Swooping",
	"Symbioting",
	"Synthesizing",
	"Tempering",
	"Thinking",
	"Thundering",
	"Tinkering",
	"Tomfoolering",
	"Topsy-turvying",
	"Transfiguring",
	"Transmuting",
	"Twisting",
	"Undulating",
	"Unfurling",
	"Unravelling",
	"Vibing",
	"Waddling",
	"Wandering",
	"Warping",
	"Whatchamacalliting",
	"Whirlpooling",
	"Whirring",
	"Whisking",
	"Wibbling",
	"Working",
	"Wrangling",
	"Zesting",
	"Zigzagging",
];

type IndicatorMode = "claude" | "default";

type ThinkingState =
	| { kind: "idle" }
	| { kind: "active"; startedAt: number }
	| { kind: "completed"; durationMs: number; shownUntil: number };

interface RuntimeStatus {
	verb: string;
	message: string;
	startedAt: number;
	thinking: ThinkingState;
	inputTokens: number;
	outputTokens: number;
	estimatedOutputTokens: number;
	lastFrameRefreshAt: number;
}

interface IndicatorPalette {
	spinner(text: string): string;
	spinnerShimmer(text: string): string;
	message(text: string): string;
	messageShimmer(text: string): string;
	status(text: string): string;
}

function getIndicatorPalette(ctx: ExtensionContext): IndicatorPalette {
	return {
		spinner: (text) => ctx.ui.theme.fg("accent", text),
		spinnerShimmer: (text) => ctx.ui.theme.fg("borderAccent", text),
		message: (text) => ctx.ui.theme.fg("accent", text),
		messageShimmer: (text) => ctx.ui.theme.fg("borderAccent", text),
		status: (text) => ctx.ui.theme.fg("dim", text),
	};
}

function getDefaultCharacters(): string[] {
	if (process.env.TERM === "xterm-ghostty") {
		return ["·", "✢", "✳", "✶", "✻", "*"];
	}

	return process.platform === "darwin" ? ["·", "✢", "✳", "✶", "✻", "✽"] : ["·", "✢", "*", "✶", "✻", "✽"];
}

function sample<T>(items: readonly T[]): T {
	return items[Math.floor(Math.random() * items.length)]!;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function formatTokens(count: number): string {
	if (count < 1000) return Math.max(0, Math.round(count)).toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function buildGlimmerMessage(message: string, frameIndex: number, palette: IndicatorPalette): string {
	const graphemes = Array.from(message);
	const cycleLength = graphemes.length + 20;
	const glimmerIndex = graphemes.length + 10 - (frameIndex % cycleLength);
	const shimmerStart = glimmerIndex - 1;
	const shimmerEnd = glimmerIndex + 1;

	if (shimmerStart >= graphemes.length || shimmerEnd < 0) {
		return palette.message(message);
	}

	return graphemes
		.map((char, index) =>
			index >= shimmerStart && index <= shimmerEnd ? palette.messageShimmer(char) : palette.message(char),
		)
		.join("");
}

function buildClaudeIndicator(
	message: string,
	statusSuffix = "",
	phaseOffset = 0,
	palette: IndicatorPalette,
): WorkingIndicatorOptions {
	const characters = getDefaultCharacters();
	const spinnerFrames = [...characters, ...[...characters].reverse()];
	const frameCount = Math.max(spinnerFrames.length, Array.from(message).length + 20);
	const status = statusSuffix ? palette.status(` ${statusSuffix}`) : "";

	return {
		frames: Array.from({ length: frameCount }, (_, index) => {
			const frameIndex = index + phaseOffset;
			const spinnerFrame = spinnerFrames[frameIndex % spinnerFrames.length]!;
			const spinner = frameIndex % 4 === 0 ? palette.spinnerShimmer(spinnerFrame) : palette.spinner(spinnerFrame);
			return `${spinner} ${buildGlimmerMessage(message, frameIndex, palette)}${status}`;
		}),
		intervalMs: 100,
	};
}

function createRuntimeStatus(): RuntimeStatus {
	const verb = sample(SPINNER_VERBS);
	return {
		verb,
		message: `${verb}…`,
		startedAt: Date.now(),
		thinking: { kind: "idle" },
		inputTokens: 0,
		outputTokens: 0,
		estimatedOutputTokens: 0,
		lastFrameRefreshAt: 0,
	};
}

function getTextLength(message: unknown): number {
	if (!message || typeof message !== "object" || !("content" in message) || !Array.isArray(message.content)) return 0;
	return message.content.reduce((total: number, item: unknown) => {
		if (!item || typeof item !== "object" || !("type" in item) || item.type !== "text") return total;
		return total + ("text" in item && typeof item.text === "string" ? item.text.length : 0);
	}, 0);
}

function getUsage(message: unknown): { input: number; output: number } {
	if (!message || typeof message !== "object" || !("usage" in message)) return { input: 0, output: 0 };
	const usage = message.usage;
	if (!usage || typeof usage !== "object") return { input: 0, output: 0 };
	return {
		input: "input" in usage && typeof usage.input === "number" ? usage.input : 0,
		output: "output" in usage && typeof usage.output === "number" ? usage.output : 0,
	};
}

function getThinkingText(thinking: ThinkingState, thinkingLevel: string, now: number): string | undefined {
	const effortSuffix = thinkingLevel === "off" ? "" : ` with ${thinkingLevel} effort`;

	if (thinking.kind === "active") {
		const elapsed = now - thinking.startedAt;
		if (elapsed > 20_000) return `thinking more${effortSuffix}`;
		if (elapsed > 10_000) return `still thinking${effortSuffix}`;
		return `thinking${effortSuffix}`;
	}

	if (thinking.kind === "completed" && now < thinking.shownUntil) {
		return `thought for ${Math.max(1, Math.round(thinking.durationMs / 1000))}s`;
	}

	return undefined;
}

function buildStatusSuffix(runtime: RuntimeStatus, thinkingLevel: string, now = Date.now()): string {
	const elapsedMs = now - runtime.startedAt;
	const showTimerAndTokens = elapsedMs > 30_000;
	const outputTokens = runtime.outputTokens || runtime.estimatedOutputTokens;
	const parts: string[] = [];

	if (showTimerAndTokens) parts.push(formatDuration(elapsedMs));
	if (showTimerAndTokens && runtime.inputTokens > 0) parts.push(`↑ ${formatTokens(runtime.inputTokens)}`);
	if (showTimerAndTokens && outputTokens > 0) parts.push(`↓ ${formatTokens(outputTokens)} tokens`);

	const thinkingText = getThinkingText(runtime.thinking, thinkingLevel, now);
	if (thinkingText) parts.push(thinkingText);

	return parts.length > 0 ? `(${parts.join(" · ")})` : "";
}

function refreshClaudeIndicator(ctx: ExtensionContext, runtime: RuntimeStatus, thinkingLevel: string): void {
	const now = Date.now();
	const phaseOffset = Math.floor((now - runtime.startedAt) / 100);
	ctx.ui.setWorkingIndicator(
		buildClaudeIndicator(
			runtime.message,
			buildStatusSuffix(runtime, thinkingLevel, now),
			phaseOffset,
			getIndicatorPalette(ctx),
		),
	);
	ctx.ui.setWorkingMessage("");
	runtime.lastFrameRefreshAt = now;
}

function applyRandomClaudeMessage(ctx: ExtensionContext, thinkingLevel = "off"): RuntimeStatus {
	const runtime = createRuntimeStatus();
	refreshClaudeIndicator(ctx, runtime, thinkingLevel);
	return runtime;
}

function applyClaudeMode(ctx: ExtensionContext, thinkingLevel = "off"): RuntimeStatus {
	return applyRandomClaudeMessage(ctx, thinkingLevel);
}

function restoreDefaultMode(ctx: ExtensionContext): void {
	ctx.ui.setWorkingIndicator();
	ctx.ui.setWorkingMessage();
}

export default function (pi: ExtensionAPI) {
	let mode: IndicatorMode = "claude";
	let runtime: RuntimeStatus | undefined;
	let tick: ReturnType<typeof setInterval> | undefined;

	const currentThinkingLevel = () => String(pi.getThinkingLevel?.() ?? "off");

	const stopTicker = () => {
		if (!tick) return;
		clearInterval(tick);
		tick = undefined;
	};

	const startTicker = (ctx: ExtensionContext) => {
		stopTicker();
		tick = setInterval(() => {
			if (mode !== "claude" || !runtime) return;
			refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
		}, 1000);
	};

	const updateRuntimeFromMessage = (message: unknown) => {
		if (!runtime) return;
		const usage = getUsage(message);
		if (usage.input > 0) runtime.inputTokens = usage.input;
		if (usage.output > 0) runtime.outputTokens = usage.output;
		runtime.estimatedOutputTokens = Math.max(runtime.estimatedOutputTokens, Math.round(getTextLength(message) / 4));
	};

	pi.on("session_start", async (_event, ctx) => {
		if (mode === "claude") runtime = applyClaudeMode(ctx, currentThinkingLevel());
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (mode !== "claude") return;
		runtime = applyRandomClaudeMessage(ctx, currentThinkingLevel());
		startTicker(ctx);
	});

	pi.on("message_update", async (event, ctx) => {
		if (mode !== "claude" || !runtime) return;
		const assistantEvent = event.assistantMessageEvent;
		const now = Date.now();
		const partial = "partial" in assistantEvent ? assistantEvent.partial : event.message;
		updateRuntimeFromMessage(partial);

		if (assistantEvent.type === "thinking_start" || assistantEvent.type === "thinking_delta") {
			if (runtime.thinking.kind !== "active") runtime.thinking = { kind: "active", startedAt: now };
			refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
			return;
		}

		if (assistantEvent.type === "thinking_end") {
			const startedAt = runtime.thinking.kind === "active" ? runtime.thinking.startedAt : now;
			runtime.thinking = { kind: "completed", durationMs: now - startedAt, shownUntil: now + 2000 };
			refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
			return;
		}

		if (now - runtime.lastFrameRefreshAt > 1000) refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
	});

	pi.on("message_end", async (event, ctx) => {
		if (mode !== "claude" || !runtime) return;
		updateRuntimeFromMessage(event.message);
		refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
	});

	pi.on("agent_end", async () => {
		stopTicker();
	});

	pi.on("session_shutdown", async () => {
		stopTicker();
	});

	pi.on("thinking_level_select", async (_event, ctx) => {
		if (mode === "claude" && runtime) refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
	});

	pi.registerCommand("claude-indicator", {
		description: "Use Claude Code-style streaming indicator: on, refresh, or reset.",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();

			if (!action || action === "on" || action === "claude") {
				mode = "claude";
				runtime = applyClaudeMode(ctx, currentThinkingLevel());
				ctx.ui.notify(`Claude indicator enabled: ${runtime.verb}…`, "info");
				return;
			}

			if (action === "refresh") {
				mode = "claude";
				runtime = applyRandomClaudeMessage(ctx, currentThinkingLevel());
				ctx.ui.notify(`Claude indicator refreshed: ${runtime.verb}…`, "info");
				return;
			}

			if (action === "reset" || action === "default" || action === "off") {
				mode = "default";
				stopTicker();
				runtime = undefined;
				restoreDefaultMode(ctx);
				ctx.ui.notify("Claude indicator disabled; restored Pi default.", "info");
				return;
			}

			ctx.ui.notify("Usage: /claude-indicator [on|refresh|reset]", "error");
		},
	});
}
