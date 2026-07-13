// ABOUTME: Pi extension showing Codex subscription usage in a footer and detailed command view.
// ABOUTME: Polls for active Codex models while keeping on-demand plan details always available.
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { retryNetworkRequest } from "./retry";
import {
	parseCodexPlanUsage,
	renderCodexPlanUsageDetails,
	renderCodexUsage,
	type CodexPlanUsage,
	type CodexUsage,
} from "./usage";

const PROVIDER_ID = "openai-codex";
const STATUS_KEY = "usage-bars";
const ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const POLL_INTERVAL_MS = 2 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 12_000;
const FRESH_FETCH_MS = 5_000;
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

type FetchResult = { ok: true; usage: CodexPlanUsage } | { ok: false; error: string; aborted?: boolean };

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

	const renderStatus = (ctx: ExtensionContext, usage: CodexUsage): string =>
		renderCodexUsage(usage, (color, text) => ctx.ui.theme.fg(color, text));

	const applyUsage = (ctx: ExtensionContext, usage: CodexPlanUsage) => {
		if (usage.windows.length > 0) {
			ctx.ui.setStatus(STATUS_KEY, renderStatus(ctx, { windows: usage.windows, usable: true }));
		}
	};

	const fetchPlanUsage = async (ctx: ExtensionContext, model: Model<any>): Promise<FetchResult> => {
		const gen = generation;
		lastFetchAt = Date.now();

		let auth: Awaited<ReturnType<ExtensionContext["modelRegistry"]["getApiKeyAndHeaders"]>>;
		try {
			auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		} catch {
			return { ok: false, error: "usage-bar: auth resolution failed" };
		}
		if (gen !== generation) return { ok: false, error: "usage-bar: cancelled", aborted: true };
		if (!auth.ok) {
			return { ok: false, error: `usage-bar: ${auth.error}` };
		}

		const headers: Record<string, string> = {
			Accept: "application/json",
			"User-Agent": "codex-cli",
			originator: "pi",
		};
		if (auth.headers) {
			for (const [key, value] of Object.entries(auth.headers)) {
				if (typeof value === "string") headers[key] = value;
			}
		}
		if (!hasAuthorization(headers) && auth.apiKey) {
			headers["Authorization"] = `Bearer ${auth.apiKey}`;
		}
		const accountId = extractAccountId(auth.apiKey);
		if (accountId && !hasHeader(headers, "chatgpt-account-id")) {
			headers["chatgpt-account-id"] = accountId;
		}

		try {
			const result = await retryNetworkRequest(
				async () => {
					const controller = new AbortController();
					abort = controller;
					let timedOut = false;
					const timeoutId = setTimeout(() => {
						timedOut = true;
						controller.abort();
					}, FETCH_TIMEOUT_MS);

					try {
						const response = await fetch(ENDPOINT, { headers, signal: controller.signal });
						const json: unknown = response.ok ? await response.json() : undefined;
						return { response, json };
					} catch (error) {
						if (timedOut) throw new Error("request timed out", { cause: error });
						throw error;
					} finally {
						clearTimeout(timeoutId);
						if (abort === controller) abort = undefined;
					}
				},
				() => gen === generation,
			);
			if (gen !== generation) return { ok: false, error: "usage-bar: cancelled", aborted: true };
			if (!result.response.ok) {
				return { ok: false, error: `usage-bar: HTTP ${result.response.status}` };
			}
			const usage = parseCodexPlanUsage(result.json, Date.now());
			if (!usage.usable) {
				return { ok: false, error: "usage-bar: unrecognized usage payload" };
			}
			return { ok: true, usage };
		} catch (err) {
			if (gen !== generation) return { ok: false, error: "usage-bar: cancelled", aborted: true };
			return {
				ok: false,
				error: `usage-bar: ${err instanceof Error ? err.message : "request failed"}`,
			};
		}
	};

	const refresh = async (ctx: ExtensionContext, model: Model<any>) => {
		const result = await fetchPlanUsage(ctx, model);
		if (!result.ok) {
			if (!result.aborted) notifyOnce(ctx, result.error);
			return;
		}
		notifiedFailure = false;
		applyUsage(ctx, result.usage);
	};

	const poll = (ctx: ExtensionContext, model: Model<any>) => {
		if (fetching) return;
		fetching = true;
		void refresh(ctx, model).finally(() => {
			fetching = false;
		});
	};

	const startTimer = (ctx: ExtensionContext, model: Model<any>) => {
		clearTimer();
		timer = setInterval(() => poll(ctx, model), POLL_INTERVAL_MS);
	};

	const notifyOnce = (ctx: ExtensionContext, message: string) => {
		if (notifiedFailure) return;
		notifiedFailure = true;
		ctx.ui.notify(message, "warning");
	};

	const sync = (ctx: ExtensionContext, model: Model<any> | undefined) => {
		if (model?.provider === PROVIDER_ID) {
			generation++;
			abort?.abort();
			if (Date.now() - lastFetchAt > FRESH_FETCH_MS) void refresh(ctx, model);
			startTimer(ctx, model);
		} else {
			deactivate(ctx);
		}
	};

	const showPlanDetails = async (ctx: ExtensionCommandContext, usage: CodexPlanUsage) => {
		const lines = renderCodexPlanUsageDetails(usage, (color, text) => ctx.ui.theme.fg(color, text));
		if (!ctx.hasUI || ctx.mode !== "tui") {
			ctx.ui.notify(stripAnsi(lines.join(" · ")), "info");
			return;
		}

		await ctx.ui.custom((_tui, theme, keybindings, done) => {
			const footer = theme.fg("dim", "Press enter or esc to close");
			const rendered = [...lines, "", footer];
			return {
				render: () => rendered,
				invalidate: () => {},
				handleInput: (data: string) => {
					if (keybindings.matches(data, "tui.select.cancel") || keybindings.matches(data, "tui.select.confirm")) {
						done(undefined);
					}
				},
			};
		});
	};

	pi.registerCommand("usages", {
		description: "Show Codex plan usage details",
		handler: async (_args, ctx) => {
			const model = ctx.modelRegistry.getAvailable().find((candidate) => candidate.provider === PROVIDER_ID);
			if (!model) {
				ctx.ui.notify("usage-bar: no Codex usage information available", "info");
				return;
			}

			const result = await fetchPlanUsage(ctx, model);
			if (!result.ok) {
				if (!result.aborted) ctx.ui.notify(result.error, "warning");
				return;
			}
			notifiedFailure = false;
			await showPlanDetails(ctx, result.usage);
		},
	});

	pi.on("session_start", (_event, ctx) => sync(ctx, ctx.model));
	pi.on("model_select", (event, ctx) => sync(ctx, event.model));
	pi.on("session_shutdown", (_event, ctx) => deactivate(ctx));
}

function hasAuthorization(headers: Record<string, string>): boolean {
	return hasHeader(headers, "authorization");
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
	const lower = name.toLowerCase();
	return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function extractAccountId(token: string | undefined): string | undefined {
	if (!token) return undefined;
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return undefined;
		const payload = JSON.parse(atob(parts[1])) as Record<string, unknown>;
		const claim = payload[JWT_CLAIM_PATH];
		if (!isPlainObject(claim)) return undefined;
		const accountId = claim["chatgpt_account_id"];
		return typeof accountId === "string" ? accountId : undefined;
	} catch {
		return undefined;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}
