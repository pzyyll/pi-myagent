// ABOUTME: Pi extension showing multi-channel subscription usage in footer and /usages.
// ABOUTME: Polls the active model channel; /usages lets you pick any supported channel.
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { Container, Text } from "@earendil-works/pi-tui";
import {
	CHANNELS,
	findChannelForModel,
	resolveModelForChannel,
	type ChannelUsageView,
	type ResolvedAuth,
	type UsageChannel,
} from "./channels";

const STATUS_KEY = "usage-bars";
const POLL_INTERVAL_MS = 2 * 60 * 1_000;
const FRESH_FETCH_MS = 5_000;

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let abort: AbortController | undefined;
	let generation = 0;
	let fetching = false;
	let lastFetchAt = 0;
	let notifiedFailure = false;

	const clearTimer = () => {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
	};

	const deactivate = (ctx: ExtensionContext) => {
		clearTimer();
		abort?.abort();
		abort = undefined;
		generation++;
		fetching = false;
		notifiedFailure = false;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	};

	const applyView = (ctx: ExtensionContext, view: ChannelUsageView) => {
		if (view.windows.length > 0) {
			ctx.ui.setStatus(
				STATUS_KEY,
				view.renderStatus((color, text) => ctx.ui.theme.fg(color, text)),
			);
		}
	};

	const resolveAuth = async (
		ctx: ExtensionContext,
		model: Model<any>,
	): Promise<{ ok: true; auth: ResolvedAuth } | { ok: false; error: string }> => {
		let resolved: Awaited<ReturnType<ExtensionContext["modelRegistry"]["getApiKeyAndHeaders"]>>;
		try {
			resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		} catch {
			return { ok: false, error: "usage-bar: auth resolution failed" };
		}
		if (!resolved.ok) {
			return { ok: false, error: `usage-bar: ${resolved.error}` };
		}
		const headers: Record<string, string> = {};
		if (resolved.headers) {
			for (const [key, value] of Object.entries(resolved.headers)) {
				if (typeof value === "string") headers[key] = value;
			}
		}
		return {
			ok: true,
			auth: {
				apiKey: resolved.apiKey,
				headers,
			},
		};
	};

	const fetchChannelUsage = async (
		ctx: ExtensionContext,
		channel: UsageChannel,
		model: Model<any>,
	): Promise<{ ok: true; view: ChannelUsageView } | { ok: false; error: string; aborted?: boolean }> => {
		const gen = generation;
		lastFetchAt = Date.now();
		const authResult = await resolveAuth(ctx, model);
		if (gen !== generation) return { ok: false, error: "usage-bar: cancelled", aborted: true };
		if (!authResult.ok) return authResult;

		abort?.abort();
		const controller = new AbortController();
		abort = controller;

		try {
			const result = await channel.fetch({
				model,
				auth: authResult.auth,
				signal: controller.signal,
				shouldContinue: () => gen === generation,
				now: Date.now(),
			});
			if (gen !== generation) return { ok: false, error: "usage-bar: cancelled", aborted: true };
			return result;
		} finally {
			if (abort === controller) abort = undefined;
		}
	};

	const refresh = async (ctx: ExtensionContext, channel: UsageChannel, model: Model<any>) => {
		const result = await fetchChannelUsage(ctx, channel, model);
		if (!result.ok) {
			if (!result.aborted) notifyOnce(ctx, result.error);
			return;
		}
		notifiedFailure = false;
		applyView(ctx, result.view);
	};

	const poll = (ctx: ExtensionContext, channel: UsageChannel, model: Model<any>) => {
		if (fetching) return;
		fetching = true;
		void refresh(ctx, channel, model).finally(() => {
			fetching = false;
		});
	};

	const startTimer = (ctx: ExtensionContext, channel: UsageChannel, model: Model<any>) => {
		clearTimer();
		timer = setInterval(() => poll(ctx, channel, model), POLL_INTERVAL_MS);
	};

	const notifyOnce = (ctx: ExtensionContext, message: string) => {
		if (notifiedFailure) return;
		notifiedFailure = true;
		ctx.ui.notify(message, "warning");
	};

	const sync = (ctx: ExtensionContext, model: Model<any> | undefined) => {
		const channel = findChannelForModel(model);
		if (model && channel) {
			generation++;
			abort?.abort();
			if (Date.now() - lastFetchAt > FRESH_FETCH_MS) void refresh(ctx, channel, model);
			startTimer(ctx, channel, model);
		} else {
			deactivate(ctx);
		}
	};

	const showPlanDetails = async (ctx: ExtensionCommandContext, view: ChannelUsageView) => {
		const lines = view.renderDetails((color, text) => ctx.ui.theme.fg(color, text));
		if (!ctx.hasUI || ctx.mode !== "tui") {
			ctx.ui.notify(stripAnsi(lines.join(" · ")), "info");
			return;
		}

		await ctx.ui.custom((_tui, theme, keybindings, done) => {
			const footer = theme.fg("dim", "Press enter or esc to close");
			const border = (s: string) => theme.fg("border", s);

			const container = new Container();
			container.addChild(new DynamicBorder(border));
			for (const line of lines) {
				container.addChild(new Text(line, 0, 0));
			}
			container.addChild(new Text("", 0, 0));
			container.addChild(new Text(footer, 0, 0));
			container.addChild(new DynamicBorder(border));

			return {
				render: (w) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					if (keybindings.matches(data, "tui.select.cancel") || keybindings.matches(data, "tui.select.confirm")) {
						done(undefined);
					}
				},
			};
		});
	};

	const pickChannel = async (ctx: ExtensionCommandContext): Promise<UsageChannel | undefined> => {
		if (CHANNELS.length === 0) return undefined;
		if (CHANNELS.length === 1) return CHANNELS[0];

		if (!ctx.hasUI) {
			ctx.ui.notify(`usage-bar: available channels: ${CHANNELS.map((channel) => channel.brand).join(", ")}`, "info");
			return undefined;
		}

		const labels = CHANNELS.map((channel) => channel.brand);
		const choice = await ctx.ui.select("Usage channel:", labels);
		if (!choice) return undefined;
		return CHANNELS.find((channel) => channel.brand === choice);
	};

	pi.registerCommand("usages", {
		description: "Pick a supported channel and show its plan usage details",
		handler: async (_args, ctx) => {
			const channel = await pickChannel(ctx);
			if (!channel) return;

			const model = resolveModelForChannel(channel, ctx.modelRegistry.getAvailable(), ctx.model);
			if (!model) {
				ctx.ui.notify(`usage-bar: no credentials available for ${channel.brand}`, "info");
				return;
			}

			const result = await fetchChannelUsage(ctx, channel, model);
			if (!result.ok) {
				if (!result.aborted) ctx.ui.notify(result.error, "warning");
				return;
			}
			notifiedFailure = false;
			await showPlanDetails(ctx, result.view);
		},
	});

	pi.on("session_start", (_event, ctx) => sync(ctx, ctx.model));
	pi.on("model_select", (event, ctx) => sync(ctx, event.model));
	pi.on("session_shutdown", (_event, ctx) => deactivate(ctx));
}

function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}
