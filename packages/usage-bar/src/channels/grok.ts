// ABOUTME: SuperGrok OAuth usage channel via cli-chat-proxy billing credits API.
// ABOUTME: Injects grok-build product headers; does not depend on xai-supergrok at runtime.
import { parseGrokPlanUsage, renderGrokPlanUsageDetails, renderGrokUsage, type GrokPlanUsage } from "../grok-usage";
import { retryNetworkRequest } from "../retry";
import type { ChannelFetchArgs, ChannelFetchResult, ChannelUsageView, UsageChannel } from "./types";

const PROVIDER_ID = "xai-supergrok";
const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const TOKEN_AUTH_HEADER = "X-XAI-Token-Auth";
const TOKEN_AUTH_VALUE = "xai-grok-cli";
const CLIENT_VERSION = "pi-usage-bar";
const CLIENT_IDENTIFIER = "grok-shell";
const CLIENT_MODE = "interactive";
const FETCH_TIMEOUT_MS = 12_000;

export const grokChannel: UsageChannel = {
	id: PROVIDER_ID,
	brand: "Grok",
	providers: [PROVIDER_ID],
	matches(provider: string) {
		return provider === PROVIDER_ID;
	},
	async fetch(args: ChannelFetchArgs): Promise<ChannelFetchResult> {
		const accessToken = bearerToken(args.auth);
		if (!accessToken) {
			return { ok: false, error: "usage-bar: missing SuperGrok access token" };
		}

		const userId = peekJwtUserId(accessToken);
		const headers: Record<string, string> = {
			Accept: "application/json",
			Authorization: `Bearer ${accessToken}`,
			[TOKEN_AUTH_HEADER]: TOKEN_AUTH_VALUE,
			"x-grok-client-version": CLIENT_VERSION,
			"x-grok-client-identifier": CLIENT_IDENTIFIER,
			"x-grok-client-mode": CLIENT_MODE,
			...args.auth.headers,
		};
		// Ensure product auth wins over any weaker registry defaults.
		headers[TOKEN_AUTH_HEADER] = TOKEN_AUTH_VALUE;
		headers["Authorization"] = `Bearer ${accessToken}`;
		if (userId && !hasHeader(headers, "x-userid")) {
			headers["x-userid"] = userId;
		}

		try {
			const result = await retryNetworkRequest(async () => {
				const controller = nestedAbort(args.signal, FETCH_TIMEOUT_MS);
				try {
					const response = await (args.fetchImpl ?? fetch)(BILLING_URL, {
						headers,
						signal: controller.signal,
					});
					const json: unknown = response.ok ? await response.json() : undefined;
					return { response, json };
				} finally {
					controller.dispose();
				}
			}, args.shouldContinue);
			if (!args.shouldContinue()) return { ok: false, error: "usage-bar: cancelled", aborted: true };
			if (!result.response.ok) {
				return { ok: false, error: `usage-bar: HTTP ${result.response.status}` };
			}
			const usage = parseGrokPlanUsage(result.json, args.now);
			if (!usage.usable) {
				return { ok: false, error: "usage-bar: unrecognized Grok usage payload" };
			}
			return { ok: true, view: toView(usage) };
		} catch (err) {
			if (!args.shouldContinue() || args.signal.aborted) {
				return { ok: false, error: "usage-bar: cancelled", aborted: true };
			}
			return {
				ok: false,
				error: `usage-bar: ${err instanceof Error ? err.message : "request failed"}`,
			};
		}
	},
};

function toView(usage: GrokPlanUsage): ChannelUsageView {
	return {
		channelId: PROVIDER_ID,
		brand: "Grok",
		windows: usage.windows,
		usable: usage.usable,
		renderDetails: (fg) => renderGrokPlanUsageDetails(usage, fg),
		renderStatus: (fg) => renderGrokUsage(usage, fg),
	};
}

function bearerToken(auth: ChannelFetchArgs["auth"]): string | undefined {
	const header = findHeader(auth.headers, "authorization");
	if (header) {
		const match = /^Bearer\s+(.+)$/i.exec(header.trim());
		if (match?.[1]) return match[1].trim();
	}
	return auth.apiKey?.trim() || undefined;
}

function peekJwtUserId(token: string): string | undefined {
	const parts = token.split(".");
	if (parts.length < 2 || !parts[1]) return undefined;
	try {
		const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/") + "===".slice((parts[1].length + 3) % 4);
		const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
		const candidates = [payload["sub"], payload["user_id"], payload["userId"]];
		for (const value of candidates) {
			if (typeof value === "string" && value.trim()) return value.trim();
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
	return findHeader(headers, name) !== undefined;
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
	const lower = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lower) return value;
	}
	return undefined;
}

function nestedAbort(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
	const controller = new AbortController();
	const onParentAbort = () => controller.abort();
	if (parent.aborted) controller.abort();
	else parent.addEventListener("abort", onParentAbort, { once: true });
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timeoutId);
			parent.removeEventListener("abort", onParentAbort);
		},
	};
}
