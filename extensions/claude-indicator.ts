import type { ExtensionAPI, ExtensionContext, WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";

const ANSI_RESET_FG = "\x1b[39m";
const CLAUDE_BLUE = "\x1b[38;2;87;105;247m";
const CLAUDE_BLUE_SHIMMER = "\x1b[38;2;117;135;255m";

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

function getDefaultCharacters(): string[] {
	if (process.env.TERM === "xterm-ghostty") {
		return ["·", "✢", "✳", "✶", "✻", "*"];
	}

	return process.platform === "darwin" ? ["·", "✢", "✳", "✶", "✻", "✽"] : ["·", "✢", "*", "✶", "✻", "✽"];
}

function colorize(text: string, color: string): string {
	return `${color}${text}${ANSI_RESET_FG}`;
}

function sample<T>(items: readonly T[]): T {
	return items[Math.floor(Math.random() * items.length)]!;
}

function buildGlimmerMessage(message: string, frameIndex: number): string {
	const graphemes = Array.from(message);
	const cycleLength = graphemes.length + 20;
	const glimmerIndex = graphemes.length + 10 - (frameIndex % cycleLength);
	const shimmerStart = glimmerIndex - 1;
	const shimmerEnd = glimmerIndex + 1;

	if (shimmerStart >= graphemes.length || shimmerEnd < 0) {
		return colorize(message, CLAUDE_BLUE);
	}

	return graphemes
		.map((char, index) =>
			colorize(char, index >= shimmerStart && index <= shimmerEnd ? CLAUDE_BLUE_SHIMMER : CLAUDE_BLUE),
		)
		.join("");
}

function buildClaudeIndicator(message: string): WorkingIndicatorOptions {
	const characters = getDefaultCharacters();
	const spinnerFrames = [...characters, ...[...characters].reverse()];
	const frameCount = Math.max(spinnerFrames.length, Array.from(message).length + 20);

	return {
		frames: Array.from({ length: frameCount }, (_, index) => {
			const spinnerFrame = spinnerFrames[index % spinnerFrames.length]!;
			const spinnerColor = index % 4 === 0 ? CLAUDE_BLUE_SHIMMER : CLAUDE_BLUE;
			return `${colorize(spinnerFrame, spinnerColor)} ${buildGlimmerMessage(message, index)}`;
		}),
		intervalMs: 100,
	};
}

function applyRandomClaudeMessage(ctx: ExtensionContext): string {
	const verb = sample(SPINNER_VERBS);
	const message = `${verb}…`;
	ctx.ui.setWorkingIndicator(buildClaudeIndicator(message));
	ctx.ui.setWorkingMessage("");
	return verb;
}

function applyClaudeMode(ctx: ExtensionContext): string {
	return applyRandomClaudeMessage(ctx);
}

function restoreDefaultMode(ctx: ExtensionContext): void {
	ctx.ui.setWorkingIndicator();
	ctx.ui.setWorkingMessage();
}

export default function (pi: ExtensionAPI) {
	let mode: IndicatorMode = "claude";

	pi.on("session_start", async (_event, ctx) => {
		if (mode === "claude") applyClaudeMode(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (mode === "claude") applyRandomClaudeMessage(ctx);
	});

	pi.registerCommand("claude-indicator", {
		description: "Use Claude Code-style streaming indicator: on, refresh, or reset.",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();

			if (!action || action === "on" || action === "claude") {
				mode = "claude";
				const verb = applyClaudeMode(ctx);
				ctx.ui.notify(`Claude indicator enabled: ${verb}…`, "info");
				return;
			}

			if (action === "refresh") {
				mode = "claude";
				const verb = applyRandomClaudeMessage(ctx);
				ctx.ui.notify(`Claude indicator refreshed: ${verb}…`, "info");
				return;
			}

			if (action === "reset" || action === "default" || action === "off") {
				mode = "default";
				restoreDefaultMode(ctx);
				ctx.ui.notify("Claude indicator disabled; restored Pi default.", "info");
				return;
			}

			ctx.ui.notify("Usage: /claude-indicator [on|refresh|reset]", "error");
		},
	});
}
