// ABOUTME: Pi extension showing Codex subscription rate-limit usage as a footer status bar.
// ABOUTME: Active only for the openai-codex provider; polls the standard codex usage endpoint.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { retryNetworkRequest } from "./retry";
import { parseCodexUsage, renderCodexUsage, type CodexUsage } from "./usage";

const PROVIDER_ID = "openai-codex";
const STATUS_KEY = "usage-bars";
const ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const POLL_INTERVAL_MS = 2 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 12_000;
const FRESH_FETCH_MS = 5_000;
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

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

	const render = (ctx: ExtensionContext, usage: CodexUsage): string =>
		renderCodexUsage(usage, (color, text) => ctx.ui.theme.fg(color, text));

	const refresh = async (ctx: ExtensionContext, model: Model<any>) => {
		const gen = generation;
		lastFetchAt = Date.now();

		let auth: Awaited<ReturnType<ExtensionContext["modelRegistry"]["getApiKeyAndHeaders"]>>;
		try {
			auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		} catch {
			notifyOnce(ctx, "usage-bar: auth resolution failed");
			return;
		}
		if (gen !== generation) return;
		if (!auth.ok) {
			notifyOnce(ctx, `usage-bar: ${auth.error}`);
			return;
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
			if (gen !== generation) return;
			if (!result.response.ok) {
				notifyOnce(ctx, `usage-bar: HTTP ${result.response.status}`);
				return;
			}
			const usage = parseCodexUsage(result.json, Date.now());
			if (!usage.usable) {
				notifyOnce(ctx, "usage-bar: unrecognized usage payload");
				return;
			}
			notifiedFailure = false;
			ctx.ui.setStatus(STATUS_KEY, render(ctx, usage));
		} catch (err) {
			if (gen === generation) {
				notifyOnce(ctx, `usage-bar: ${err instanceof Error ? err.message : "request failed"}`);
			}
		}
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
