import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";

type ThemeColorName = Parameters<ExtensionContext["ui"]["theme"]["fg"]>[0];
type ThemeColorMode = ReturnType<ExtensionContext["ui"]["theme"]["getColorMode"]>;

const ANSI_RESET_FG = "\x1b[39m";
const DEFAULT_INDICATOR_COLOR = "warning";

// ---------------------------------------------------------------------------
// Resolved color: decouples colour consumers from the source (theme name or
// hex literal).  Every resolved colour carries an RGB for shimmer/stall
// derivation and a foreground formatter for simple styled text.
// ---------------------------------------------------------------------------
interface ResolvedColor {
	rgb: RgbColor | undefined;
	fg(text: string): string;
}

function resolveColor(ctx: ExtensionContext, raw: string, fallback = DEFAULT_INDICATOR_COLOR): ResolvedColor {
	const normalized = raw.trim() || fallback;
	const hex = parseHexColor(normalized);
	if (hex) {
		const mode = ctx.ui.theme.getColorMode();
		return {
			rgb: hex,
			fg: (text) => `${formatAnsiForeground(hex, mode)}${text}${ANSI_RESET_FG}`,
		};
	}

	// Theme colour name
	const name = normalized as ThemeColorName;
	let ansi: string;
	try {
		ansi = ctx.ui.theme.getFgAnsi(name);
	} catch {
		if (normalized !== fallback) return resolveColor(ctx, fallback);
		return resolveColor(ctx, DEFAULT_INDICATOR_COLOR);
	}
	const rgb = parseAnsiForeground(ansi);
	return {
		rgb,
		fg: (text) => ctx.ui.theme.fg(name, text),
	};
}

function parseHexColor(raw: string): RgbColor | undefined {
	const m = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
	if (!m) return undefined;
	const hex = m[1]!;
	if (hex.length === 3) {
		return {
			r: parseInt(hex[0]! + hex[0]!, 16),
			g: parseInt(hex[1]! + hex[1]!, 16),
			b: parseInt(hex[2]! + hex[2]!, 16),
		};
	}
	return {
		r: parseInt(hex.slice(0, 2), 16),
		g: parseInt(hex.slice(2, 4), 16),
		b: parseInt(hex.slice(4, 6), 16),
	};
}

function loadClaudeIndicatorSetting(cwd: string, key: string, fallback: string): string {
	const globalPath = join(homedir(), ".pi", "agent", "settings.json");
	const projectPath = join(cwd, ".pi", "settings.json");

	// Project settings override global
	for (const path of [projectPath, globalPath]) {
		try {
			const raw = readFileSync(path, "utf-8");
			const settings = JSON.parse(raw) as Record<string, unknown>;
			const section = settings.claudeIndicator;
			if (typeof section === "object" && section !== null) {
				const value = (section as Record<string, unknown>)[key];
				if (typeof value === "string" && value.trim()) return value.trim();
			}
		} catch {
			// File missing or unparseable — try next
		}
	}

	return fallback;
}

function loadClaudeIndicatorNumber(cwd: string, key: string, fallback: number): number {
	const globalPath = join(homedir(), ".pi", "agent", "settings.json");
	const projectPath = join(cwd, ".pi", "settings.json");

	// Project settings override global
	for (const path of [projectPath, globalPath]) {
		try {
			const raw = readFileSync(path, "utf-8");
			const settings = JSON.parse(raw) as Record<string, unknown>;
			const section = settings.claudeIndicator;
			if (typeof section === "object" && section !== null) {
				const value = (section as Record<string, unknown>)[key];
				if (typeof value === "number" && Number.isFinite(value)) return value;
				if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
			}
		} catch {
			// File missing or unparseable — try next
		}
	}

	return fallback;
}

let INDICATOR_COLOR: ResolvedColor | undefined = {
	rgb: { r: 255, g: 200, b: 0 },
	fg: (text) => text,
};
let THINKING_SHIMMER_COLOR: ResolvedColor | undefined = {
	rgb: { r: 185, g: 185, b: 185 },
	fg: (text) => text,
};
const SHIMMER_CHANNEL_BOOST = 30;
// Shimmer is derived by rotating the base colour's hue around the colour wheel
// by this many degrees (0/360 = same colour, 180 = complementary).
const DEFAULT_SHIMMER_HUE_SHIFT = 30;
let SHIMMER_HUE_SHIFT = DEFAULT_SHIMMER_HUE_SHIFT;
// After rotating hue, lift the shimmer's lightness by this fraction (0-1) for a
// glow on top of the colour shift; 0 = pure hue rotation, no extra brightness.
const DEFAULT_SHIMMER_LIGHTNESS_BOOST = 0.1;
let SHIMMER_LIGHTNESS_BOOST = DEFAULT_SHIMMER_LIGHTNESS_BOOST;
const ANSI_256_CUBE_VALUES = [0, 95, 135, 175, 215, 255] as const;
const ANSI_256_GRAY_VALUES = Array.from({ length: 24 }, (_, index) => 8 + index * 10);

const THINKING_STILL_MS = 10_000;
const THINKING_MORE_MS = 20_000;
const STATUS_SUFFIX_AFTER_MS = 30_000;
const THINKING_COMPLETED_SHOWN_MS = 2000;
const INDICATOR_TICK_MS = 1000;
const INDICATOR_REFRESH_THROTTLE_MS = 1000;

const THINKING_GLOW_PERIOD_MS = 2000;
// The breathing centre colour ramps from dim toward the indicator colour across
// this span, so a longer think reads as "closer to the indicator". Aligned with
// THINKING_MORE_MS so full colour lands when the text flips to "thinking more".
const THINKING_RAMP_MS = 20_000;
// Subtle HSL lightness lift for the bright phase of each breath, applied on top
// of whatever centre colour the ramp has reached.
const THINKING_GLOW_LIGHTNESS_BOOST = 0.12;

// Glimmer cadence: use Claude's requesting/responding speeds, and apply the
// same frame cadence to both spinner shimmer and message shimmer.
const GLIMMER_INTERVAL_REQUESTING_MS = 50;
const GLIMMER_INTERVAL_RESPONDING_MS = 200;

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

type IndicatorMode = typeof CLAUDE_MODE | "default";
const CLAUDE_MODE = "claude" as const;

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
	lastProgressAt: number;
	activeTools: number;
	requesting: boolean;
}

interface IndicatorPalette {
	spinner(text: string): string;
	spinnerShimmer(text: string): string;
	message(text: string): string;
	messageShimmer(text: string): string;
	messageFlash(text: string, opacity: number): string;
	ramp(text: string, progress: number, opacity: number): string;
	status(text: string): string;
	stall(text: string): string;
	thinking: { base: RgbColor; shimmer: RgbColor };
}

interface RgbColor {
	r: number;
	g: number;
	b: number;
}

function getIndicatorPalette(ctx: ExtensionContext, color: ResolvedColor, stallIntensity = 0): IndicatorPalette {
	const primary = color.fg;
	const shimmer = getDerivedThemeShimmer(ctx, color);
	const flash = getFlashRenderer(ctx, color);
	const ramp = getRampRenderer(ctx, color);
	const stall = getStallRenderer(ctx, color, stallIntensity);

	const thinkingColors = getThinkingShimmerColors(ctx, THINKING_SHIMMER_COLOR!);

	return {
		spinner: primary,
		spinnerShimmer: shimmer,
		message: primary,
		messageShimmer: shimmer,
		messageFlash: flash,
		ramp,
		status: (text) => ctx.ui.theme.fg("dim", text),
		stall,
		thinking: thinkingColors,
	};
}

const THINKING_INACTIVE: RgbColor = { r: 153, g: 153, b: 153 };
const THINKING_INACTIVE_SHIMMER: RgbColor = { r: 185, g: 185, b: 185 };

function getThinkingShimmerColors(
	ctx: ExtensionContext,
	indicator: ResolvedColor,
): { base: RgbColor; shimmer: RgbColor } {
	const dimAnsi = ctx.ui.theme.getFgAnsi("dim");
	const baseRgb = parseAnsiForeground(dimAnsi) ?? THINKING_INACTIVE;
	const shimmerRgb = indicator.rgb ?? THINKING_INACTIVE_SHIMMER;
	return { base: baseRgb, shimmer: shimmerRgb };
}

function getDerivedThemeShimmer(ctx: ExtensionContext, color: ResolvedColor): (text: string) => string {
	const rgb = color.rgb;
	if (!rgb) return color.fg;

	const shimmer = deriveShimmerColor(rgb);
	const ansi = formatAnsiForeground(shimmer, ctx.ui.theme.getColorMode());
	return (text) => `${ansi}${text}${ANSI_RESET_FG}`;
}

// Tool-use flash: the whole message pulses between the base colour and the
// derived shimmer colour by `opacity` (0 = base, 1 = shimmer), instead of the
// sweeping glimmer window.  Mirrors Claude Code's tool-use GlimmerMessage path.
function getFlashRenderer(ctx: ExtensionContext, color: ResolvedColor): (text: string, opacity: number) => string {
	const rgb = color.rgb;
	if (!rgb) return (text) => color.fg(text);

	const shimmer = deriveShimmerColor(rgb);
	const mode = ctx.ui.theme.getColorMode();
	return (text, opacity) => {
		const mixed = mixColors(rgb, shimmer, Math.max(0, Math.min(1, opacity)));
		return `${formatAnsiForeground(mixed, mode)}${text}${ANSI_RESET_FG}`;
	};
}

// Long-think ramp: the breathing centre drifts from the base colour toward the
// derived shimmer by `progress` (0 = base, 1 = shimmer), and each breath pulses
// between that centre and a slightly lighter version of it via `opacity`.  Used
// for spinner + message once a think passes THINKING_STILL_MS.
function getRampRenderer(
	ctx: ExtensionContext,
	color: ResolvedColor,
): (text: string, progress: number, opacity: number) => string {
	const rgb = color.rgb;
	if (!rgb) return (text) => color.fg(text);

	const shimmer = deriveShimmerColor(rgb);
	const mode = ctx.ui.theme.getColorMode();
	return (text, progress, opacity) => {
		const center = mixColors(rgb, shimmer, Math.max(0, Math.min(1, progress)));
		const glow = lightenColor(center, THINKING_GLOW_LIGHTNESS_BOOST);
		const mixed = mixColors(center, glow, Math.max(0, Math.min(1, opacity)));
		return `${formatAnsiForeground(mixed, mode)}${text}${ANSI_RESET_FG}`;
	};
}

function parseAnsiForeground(ansi: string): RgbColor | undefined {
	const trueColor = ansi.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
	if (trueColor) {
		return {
			r: clampColor(Number(trueColor[1])),
			g: clampColor(Number(trueColor[2])),
			b: clampColor(Number(trueColor[3])),
		};
	}

	const indexedColor = ansi.match(/\x1b\[38;5;(\d+)m/);
	if (indexedColor) return ansi256ToRgb(clampColor(Number(indexedColor[1])));

	const basicColor = ansi.match(/\x1b\[(3\d|9\d)m/);
	if (basicColor) return ansi16ToRgb(Number(basicColor[1]));

	return undefined;
}

// RGB (0-255) -> HSL with hue in degrees [0,360) and s/l in [0,1].
function rgbToHsl({ r, g, b }: RgbColor): { h: number; s: number; l: number } {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const delta = max - min;
	const l = (max + min) / 2;

	let h = 0;
	let s = 0;
	if (delta !== 0) {
		s = delta / (1 - Math.abs(2 * l - 1));
		switch (max) {
			case rn:
				h = ((gn - bn) / delta) % 6;
				break;
			case gn:
				h = (bn - rn) / delta + 2;
				break;
			default:
				h = (rn - gn) / delta + 4;
				break;
		}
		h *= 60;
		if (h < 0) h += 360;
	}

	return { h, s, l };
}

// HSL (hue in degrees, s/l in [0,1]) -> RGB (0-255).
function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): RgbColor {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;

	let r = 0;
	let g = 0;
	let b = 0;
	if (h < 60) {
		r = c;
		g = x;
	} else if (h < 120) {
		r = x;
		g = c;
	} else if (h < 180) {
		g = c;
		b = x;
	} else if (h < 240) {
		g = x;
		b = c;
	} else if (h < 300) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}

	return {
		r: clampColor((r + m) * 255),
		g: clampColor((g + m) * 255),
		b: clampColor((b + m) * 255),
	};
}

function deriveShimmerColor(color: RgbColor): RgbColor {
	const { h, s, l } = rgbToHsl(color);

	// Grays / near-white have no meaningful hue to rotate, so fall back to a
	// brightness shift to keep the shimmer visible.
	if (s < 0.1) {
		const nearWhite = getLuminance(color) > 0.85 && Math.min(color.r, color.g, color.b) > 180;
		if (nearWhite) return mixColors(color, { r: 0, g: 0, b: 0 }, 0.1);

		return {
			r: clampColor(color.r + SHIMMER_CHANNEL_BOOST),
			g: clampColor(color.g + SHIMMER_CHANNEL_BOOST),
			b: clampColor(color.b + SHIMMER_CHANNEL_BOOST),
		};
	}

	// Rotate hue around the wheel (0/360 = same colour), then lift lightness so
	// the shimmer both shifts colour and glows.
	const rotated = (((h + SHIMMER_HUE_SHIFT) % 360) + 360) % 360;
	const lit = Math.max(0, Math.min(1, l + SHIMMER_LIGHTNESS_BOOST));
	return hslToRgb({ h: rotated, s, l: lit });
}

// Lift a colour's lightness by `boost` (0-1) while keeping hue and saturation,
// so the glow stays the same colour rather than washing toward white.
function lightenColor(color: RgbColor, boost: number): RgbColor {
	const { h, s, l } = rgbToHsl(color);
	return hslToRgb({ h, s, l: Math.max(0, Math.min(1, l + boost)) });
}

function getLuminance({ r, g, b }: RgbColor): number {
	const toLinear = (channel: number) => {
		const value = channel / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};

	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function mixColors(from: RgbColor, to: RgbColor, amount: number): RgbColor {
	return {
		r: clampColor(from.r + (to.r - from.r) * amount),
		g: clampColor(from.g + (to.g - from.g) * amount),
		b: clampColor(from.b + (to.b - from.b) * amount),
	};
}

function formatAnsiForeground(color: RgbColor, mode: ThemeColorMode): string {
	if (mode === "truecolor") return `\x1b[38;2;${color.r};${color.g};${color.b}m`;
	return `\x1b[38;5;${rgbToAnsi256(color)}m`;
}

function findClosestValueIndex(value: number, values: readonly number[]): number {
	let minDistance = Infinity;
	let minIndex = 0;

	for (let index = 0; index < values.length; index++) {
		const candidate = values[index]!;
		const distance = Math.abs(value - candidate);
		if (distance < minDistance) {
			minDistance = distance;
			minIndex = index;
		}
	}

	return minIndex;
}

function colorDistance(from: RgbColor, to: RgbColor): number {
	const dr = from.r - to.r;
	const dg = from.g - to.g;
	const db = from.b - to.b;
	return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
}

function rgbToAnsi256({ r, g, b }: RgbColor): number {
	const rIndex = findClosestValueIndex(r, ANSI_256_CUBE_VALUES);
	const gIndex = findClosestValueIndex(g, ANSI_256_CUBE_VALUES);
	const bIndex = findClosestValueIndex(b, ANSI_256_CUBE_VALUES);
	const cubeColor = {
		r: ANSI_256_CUBE_VALUES[rIndex]!,
		g: ANSI_256_CUBE_VALUES[gIndex]!,
		b: ANSI_256_CUBE_VALUES[bIndex]!,
	};
	const cubeIndex = 16 + 36 * rIndex + 6 * gIndex + bIndex;
	const cubeDistance = colorDistance({ r, g, b }, cubeColor);

	const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
	const grayIndex = findClosestValueIndex(gray, ANSI_256_GRAY_VALUES);
	const grayValue = ANSI_256_GRAY_VALUES[grayIndex]!;
	const grayDistance = colorDistance({ r, g, b }, { r: grayValue, g: grayValue, b: grayValue });
	const spread = Math.max(r, g, b) - Math.min(r, g, b);

	if (spread < 10 && grayDistance < cubeDistance) return 232 + grayIndex;
	return cubeIndex;
}

function ansi16ToRgb(code: number): RgbColor | undefined {
	const colors: Record<number, RgbColor> = {
		30: { r: 0, g: 0, b: 0 },
		31: { r: 128, g: 0, b: 0 },
		32: { r: 0, g: 128, b: 0 },
		33: { r: 128, g: 128, b: 0 },
		34: { r: 0, g: 0, b: 128 },
		35: { r: 128, g: 0, b: 128 },
		36: { r: 0, g: 128, b: 128 },
		37: { r: 192, g: 192, b: 192 },
		90: { r: 128, g: 128, b: 128 },
		91: { r: 255, g: 0, b: 0 },
		92: { r: 0, g: 255, b: 0 },
		93: { r: 255, g: 255, b: 0 },
		94: { r: 0, g: 0, b: 255 },
		95: { r: 255, g: 0, b: 255 },
		96: { r: 0, g: 255, b: 255 },
		97: { r: 255, g: 255, b: 255 },
	};

	return colors[code];
}

function ansi256ToRgb(index: number): RgbColor {
	if (index < 16) return ansi16ToRgb(index < 8 ? index + 30 : index + 82) ?? { r: 255, g: 255, b: 255 };

	if (index >= 232) {
		const value = 8 + (index - 232) * 10;
		return { r: value, g: value, b: value };
	}

	const normalized = index - 16;
	const r = Math.floor(normalized / 36);
	const g = Math.floor((normalized % 36) / 6);
	const b = normalized % 6;
	const channel = (value: number) => (value === 0 ? 0 : 55 + value * 40);

	return { r: channel(r), g: channel(g), b: channel(b) };
}

function clampColor(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
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

function getGlimmerIntervalMs(requesting: boolean): number {
	return requesting ? GLIMMER_INTERVAL_REQUESTING_MS : GLIMMER_INTERVAL_RESPONDING_MS;
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

function buildGlimmerMessage(
	message: string,
	frameIndex: number,
	palette: IndicatorPalette,
	requesting = false,
): string {
	const graphemes = Array.from(message);
	const cycleLength = graphemes.length + 20;
	const glimmerIndex = requesting
		? (frameIndex % cycleLength) - 10
		: graphemes.length + 10 - (frameIndex % cycleLength);
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

// Claude Code reddens the spinner when output stalls and no tools run; match its
// ERROR_RED target and the 3s-then-2s-ramp curve from useStalledAnimation.
const STALL_ERROR_RGB: RgbColor = { r: 171, g: 43, b: 63 };
const STALL_AFTER_MS = 3000;
const STALL_RAMP_MS = 2000;

function computeStallIntensity(runtime: RuntimeStatus, now: number): number {
	if (runtime.activeTools > 0) return 0;
	const idleMs = now - runtime.lastProgressAt;
	if (idleMs <= STALL_AFTER_MS) return 0;
	return Math.min((idleMs - STALL_AFTER_MS) / STALL_RAMP_MS, 1);
}

function getStallRenderer(ctx: ExtensionContext, color: ResolvedColor, intensity: number): (text: string) => string {
	if (intensity <= 0) return color.fg;

	const rgb = color.rgb;
	if (!rgb) {
		return color.fg;
	}

	const ansi = formatAnsiForeground(
		mixColors(rgb, STALL_ERROR_RGB, Math.min(intensity, 1)),
		ctx.ui.theme.getColorMode(),
	);
	return (text) => `${ansi}${text}${ANSI_RESET_FG}`;
}

function buildClaudeIndicator(
	message: string,
	prefixParts: string[],
	thinkingText: string | undefined,
	thinking: ThinkingState,
	requesting: boolean,
	phaseOffset = 0,
	palette: IndicatorPalette,
	colorMode: ThemeColorMode,
	stalled = false,
	toolUse = false,
	now = Date.now(),
): WorkingIndicatorOptions {
	const characters = getDefaultCharacters();
	const spinnerFrames = [...characters, ...[...characters].reverse()];
	const frameCount = Math.max(spinnerFrames.length, Array.from(message).length + 20);
	const intervalMs = getGlimmerIntervalMs(requesting);

	return {
		frames: Array.from({ length: frameCount }, (_, index) => {
			const frameIndex = index + phaseOffset;
			const spinnerFrame = spinnerFrames[frameIndex % spinnerFrames.length]!;
			const frameTime = now + index * intervalMs;

			// Long-think phase 2: from STILL onward, spinner+message drift their
			// colour from base toward shimmer, reaching full shimmer at
			// THINKING_RAMP_MS (in sync with the thinking text) with the same 2s
			// breathing glow. Before STILL it stays the normal glimmer sweep.
			const thinkingElapsed = thinking.kind === "active" ? frameTime - thinking.startedAt : -1;
			const inRamp = !stalled && !toolUse && thinkingElapsed >= THINKING_STILL_MS;
			const rampProgress = inRamp
				? Math.max(
						0,
						Math.min(1, (thinkingElapsed - THINKING_STILL_MS) / Math.max(1, THINKING_RAMP_MS - THINKING_STILL_MS)),
					)
				: 0;
			const rampBreath = inRamp ? (Math.sin((thinkingElapsed / THINKING_GLOW_PERIOD_MS) * Math.PI * 2) + 1) / 2 : 0;

			let spinner: string;
			if (stalled) {
				spinner = palette.stall(spinnerFrame);
			} else if (inRamp) {
				spinner = palette.ramp(spinnerFrame, rampProgress, rampBreath);
			} else if (frameIndex % 4 === 0) {
				spinner = palette.spinnerShimmer(spinnerFrame);
			} else {
				spinner = palette.spinner(spinnerFrame);
			}

			let renderedMessage: string;
			if (stalled) {
				renderedMessage = palette.stall(message);
			} else if (inRamp) {
				renderedMessage = palette.ramp(message, rampProgress, rampBreath);
			} else if (toolUse) {
				// While a tool runs, pulse the whole message on a 2s sine wave
				// between base and shimmer instead of sweeping the glimmer window.
				const flashOpacity = (Math.sin((frameTime / 1000) * Math.PI) + 1) / 2;
				renderedMessage = palette.messageFlash(message, flashOpacity);
			} else {
				renderedMessage = buildGlimmerMessage(message, frameIndex, palette, requesting);
			}
			// Prefix in dim, thinking text in independent gray breathing shimmer
			const thinkingColor =
				thinkingText && thinking.kind === "active"
					? computeThinkingColorAnsi(thinking, frameTime, colorMode, palette.thinking)
					: undefined;
			const statusParts = prefixParts.map((part) => palette.status(part));
			const status = statusParts.length
				? ` ${palette.status("(")}${statusParts.join(palette.status(" · "))}${palette.status(")")}`
				: "";
			const thinkingPart = thinkingText
				? ` ${palette.status("·")} ${thinkingColor ? `${thinkingColor}${thinkingText}${ANSI_RESET_FG}` : palette.status(thinkingText)}`
				: "";

			return `${spinner} ${renderedMessage}${status}${thinkingPart}`;
		}),
		intervalMs,
	};
}

function createRuntimeStatus(requesting = false): RuntimeStatus {
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
		lastProgressAt: Date.now(),
		activeTools: 0,
		requesting,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && value !== undefined && typeof value === "object";
}

function hasOwnProp(value: unknown, key: string): value is Record<string, unknown> {
	return isRecord(value) && key in value;
}

function hasOwnArray(value: unknown, key: string): value is { [k: string]: unknown } & Record<string, unknown> {
	return hasOwnProp(value, key) && Array.isArray(value[key]);
}

function getTextLength(message: unknown): number {
	if (!hasOwnArray(message, "content")) return 0;
	return (message.content as unknown[]).reduce((total: number, item: unknown) => {
		if (!hasOwnProp(item, "type") || item.type !== "text") return total;
		if (!hasOwnProp(item, "text") || typeof item.text !== "string") return total;
		return total + item.text.length;
	}, 0);
}

function getUsage(message: unknown): { input: number; output: number } {
	if (!hasOwnProp(message, "usage")) return { input: 0, output: 0 };
	const usage = message.usage;
	if (!hasOwnProp(usage, "input") && !hasOwnProp(usage, "output")) return { input: 0, output: 0 };
	return {
		input: hasOwnProp(usage, "input") && typeof usage.input === "number" ? usage.input : 0,
		output: hasOwnProp(usage, "output") && typeof usage.output === "number" ? usage.output : 0,
	};
}

function getThinkingText(thinking: ThinkingState, thinkingLevel: string, now: number): string | undefined {
	const effortSuffix = thinkingLevel === "off" ? "" : ` with ${thinkingLevel} effort`;

	if (thinking.kind === "active") {
		const elapsed = now - thinking.startedAt;
		if (elapsed > THINKING_MORE_MS) return `thinking more${effortSuffix}`;
		if (elapsed > THINKING_STILL_MS) return `still thinking${effortSuffix}`;
		return `thinking${effortSuffix}`;
	}

	if (thinking.kind === "completed" && now < thinking.shownUntil) {
		return `thought for ${Math.max(1, Math.round(thinking.durationMs / 1000))}s`;
	}

	return undefined;
}

function buildStatusParts(
	runtime: RuntimeStatus,
	thinkingLevel: string,
	now = Date.now(),
): { prefixParts: string[]; thinking: string | undefined } {
	const elapsedMs = now - runtime.startedAt;
	const showTimerAndTokens = elapsedMs > STATUS_SUFFIX_AFTER_MS;
	const outputTokens = runtime.outputTokens || runtime.estimatedOutputTokens;
	const prefixParts: string[] = [];

	if (showTimerAndTokens) prefixParts.push(formatDuration(elapsedMs));
	if (showTimerAndTokens && runtime.inputTokens > 0) prefixParts.push(`↑ ${formatTokens(runtime.inputTokens)}`);
	if (showTimerAndTokens && outputTokens > 0) prefixParts.push(`↓ ${formatTokens(outputTokens)} tokens`);

	return {
		prefixParts,
		thinking: getThinkingText(runtime.thinking, thinkingLevel, now),
	};
}

function computeThinkingColorAnsi(
	thinking: ThinkingState,
	frameTimeMs: number,
	colorMode: ThemeColorMode,
	colors: { base: RgbColor; shimmer: RgbColor },
): string | undefined {
	if (thinking.kind !== "active") return undefined;
	const elapsed = frameTimeMs - thinking.startedAt;
	if (elapsed < 0) return undefined;
	// Breathing centre drifts from the dim base toward the indicator colour as
	// the think runs longer; full colour lands at THINKING_RAMP_MS.
	const progress = Math.max(0, Math.min(1, elapsed / THINKING_RAMP_MS));
	const center = mixColors(colors.base, colors.shimmer, progress);
	// Each breath pulses between the centre and a slightly lighter version of it,
	// so the glow stays on-colour at every point along the ramp.
	const glow = lightenColor(center, THINKING_GLOW_LIGHTNESS_BOOST);
	const opacity = (Math.sin((elapsed / THINKING_GLOW_PERIOD_MS) * Math.PI * 2) + 1) / 2;
	return formatAnsiForeground(mixColors(center, glow, opacity), colorMode);
}

function refreshClaudeIndicator(ctx: ExtensionContext, runtime: RuntimeStatus, thinkingLevel: string): void {
	const now = Date.now();
	const intervalMs = getGlimmerIntervalMs(runtime.requesting);
	const phaseOffset = Math.floor((now - runtime.startedAt) / intervalMs);
	const stallIntensity = computeStallIntensity(runtime, now);
	// Tool execution maps to Claude Code's tool-use mode: whole-message flash.
	// Stall and tool-use are mutually exclusive (stall is forced to 0 while
	// tools run), but stall takes priority inside buildClaudeIndicator anyway.
	const toolUse = stallIntensity <= 0 && runtime.activeTools > 0;
	const { prefixParts, thinking } = buildStatusParts(runtime, thinkingLevel, now);
	ctx.ui.setWorkingIndicator(
		buildClaudeIndicator(
			runtime.message,
			prefixParts,
			thinking,
			runtime.thinking,
			runtime.requesting,
			phaseOffset,
			getIndicatorPalette(ctx, INDICATOR_COLOR!, stallIntensity),
			ctx.ui.theme.getColorMode(),
			stallIntensity > 0,
			toolUse,
			now,
		),
	);
	ctx.ui.setWorkingMessage("");
	runtime.lastFrameRefreshAt = now;
}

function applyRandomClaudeMessage(ctx: ExtensionContext, thinkingLevel = "off", requesting = false): RuntimeStatus {
	const runtime = createRuntimeStatus(requesting);
	refreshClaudeIndicator(ctx, runtime, thinkingLevel);
	return runtime;
}

function restoreDefaultMode(ctx: ExtensionContext): void {
	ctx.ui.setWorkingIndicator();
	ctx.ui.setWorkingMessage();
}

export default function (pi: ExtensionAPI) {
	let mode: IndicatorMode = CLAUDE_MODE;
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
			if (mode !== CLAUDE_MODE || !runtime) return;
			refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
		}, INDICATOR_TICK_MS);
	};

	const updateRuntimeFromMessage = (message: unknown) => {
		if (!runtime) return;
		const usage = getUsage(message);
		if (usage.input > 0) runtime.inputTokens = usage.input;
		if (usage.output > 0) runtime.outputTokens = usage.output;
		runtime.estimatedOutputTokens = Math.max(runtime.estimatedOutputTokens, Math.round(getTextLength(message) / 4));
	};

	pi.on("session_start", (_event, ctx) => {
		const indicatorRaw = loadClaudeIndicatorSetting(ctx.cwd, "defaultColor", DEFAULT_INDICATOR_COLOR);
		INDICATOR_COLOR = resolveColor(ctx, indicatorRaw);
		THINKING_SHIMMER_COLOR = resolveColor(
			ctx,
			loadClaudeIndicatorSetting(ctx.cwd, "thinkingShimmerColor", indicatorRaw),
			indicatorRaw,
		);
		SHIMMER_HUE_SHIFT = loadClaudeIndicatorNumber(ctx.cwd, "shimmerHueShift", DEFAULT_SHIMMER_HUE_SHIFT);
		SHIMMER_LIGHTNESS_BOOST = loadClaudeIndicatorNumber(
			ctx.cwd,
			"shimmerLightnessBoost",
			DEFAULT_SHIMMER_LIGHTNESS_BOOST,
		);
		if (mode === CLAUDE_MODE) runtime = applyRandomClaudeMessage(ctx, currentThinkingLevel());
	});

	pi.on("agent_start", (_event, ctx) => {
		if (mode !== CLAUDE_MODE) return;
		runtime = applyRandomClaudeMessage(ctx, currentThinkingLevel(), true);
		startTicker(ctx);
	});

	pi.on("message_update", (event, ctx) => {
		if (mode !== CLAUDE_MODE || !runtime) return;
		const assistantEvent = event.assistantMessageEvent;
		const now = Date.now();
		const wasRequesting = runtime.requesting;
		runtime.requesting = false;
		runtime.lastProgressAt = now;
		const partial = "partial" in assistantEvent ? assistantEvent.partial : event.message;
		updateRuntimeFromMessage(partial);

		if (assistantEvent.type === "thinking_start" || assistantEvent.type === "thinking_delta") {
			if (runtime.thinking.kind !== "active") runtime.thinking = { kind: "active", startedAt: now };
			refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
			return;
		}

		if (assistantEvent.type === "thinking_end") {
			const startedAt = runtime.thinking.kind === "active" ? runtime.thinking.startedAt : now;
			runtime.thinking = {
				kind: "completed",
				durationMs: now - startedAt,
				shownUntil: now + THINKING_COMPLETED_SHOWN_MS,
			};
			refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
			return;
		}

		if (wasRequesting || now - runtime.lastFrameRefreshAt > INDICATOR_REFRESH_THROTTLE_MS)
			refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
	});

	pi.on("message_end", (event, ctx) => {
		if (mode !== CLAUDE_MODE || !runtime) return;
		runtime.lastProgressAt = Date.now();
		updateRuntimeFromMessage(event.message);
		refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
	});

	pi.on("tool_execution_start", (_event, ctx) => {
		if (mode !== CLAUDE_MODE || !runtime) return;
		runtime.activeTools += 1;
		runtime.lastProgressAt = Date.now();
		refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
	});

	pi.on("tool_execution_end", (_event, ctx) => {
		if (mode !== CLAUDE_MODE || !runtime) return;
		runtime.activeTools = Math.max(0, runtime.activeTools - 1);
		runtime.lastProgressAt = Date.now();
		refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
	});

	pi.on("agent_end", async () => {
		stopTicker();
	});

	pi.on("session_shutdown", async () => {
		stopTicker();
	});

	pi.on("thinking_level_select", (_event, ctx) => {
		if (mode === CLAUDE_MODE && runtime) refreshClaudeIndicator(ctx, runtime, currentThinkingLevel());
	});

	pi.registerCommand("claude-indicator", {
		description: "Use Claude Code-style streaming indicator: on, refresh, or reset.",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();

			if (!action || action === "on" || action === CLAUDE_MODE) {
				mode = CLAUDE_MODE;
				runtime = applyRandomClaudeMessage(ctx, currentThinkingLevel());
				ctx.ui.notify(`Claude indicator enabled: ${runtime.verb}…`, "info");
				return;
			}

			if (action === "refresh") {
				mode = CLAUDE_MODE;
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
