// ABOUTME: Fetches and parses the SuperGrok cli-chat-proxy /v1/models catalog.
// ABOUTME: Mirrors grok-build session-auth model listing for OAuth credential storage.

import { resolveXaiModelCost } from "./pricing";

/** Canonical wire values for Responses `reasoning.effort` (grok-build ReasoningEffort). */
export type ReasoningEffortWire = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Built-in menu when supportsReasoningEffort but no server `reasoningEfforts` list.
 * Matches grok-build `legacy_effort_options` (low..xhigh; none/minimal not offered).
 */
export const LEGACY_REASONING_EFFORTS: readonly ReasoningEffortWire[] = ["low", "medium", "high", "xhigh"];

/** Pi thinkingLevelMap keys ↔ wire effort (off → none). */
export type ThinkingLevelMap = {
	off: string | null;
	minimal: string | null;
	low: string | null;
	medium: string | null;
	high: string | null;
	xhigh: string | null;
};

/** Serializable model entry cached on OAuth credentials. */
export interface CatalogModel {
	id: string;
	name: string;
	reasoning: boolean;
	/** Server menu values when present; omit → legacy low..xhigh when reasoning. */
	reasoningEfforts?: ReasoningEffortWire[];
	input: Array<"text" | "image">;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	contextWindow: number;
	maxTokens: number;
}

/** Matches live cli-chat-proxy entitlements when the proxy is unreachable. */
export const FALLBACK_CATALOG: CatalogModel[] = [
	{
		id: "grok-4.5",
		name: "Grok 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: resolveXaiModelCost("grok-4.5"),
		contextWindow: 500_000,
		maxTokens: 128_000,
	},
	{
		id: "grok-build",
		name: "Grok Build",
		// Grok Build client: supportsReasoningEffort=false; explicit effort can 400.
		reasoning: false,
		input: ["text", "image"],
		cost: resolveXaiModelCost("grok-build"),
		contextWindow: 500_000,
		maxTokens: 128_000,
	},
];

/** Default context window when the remote entry omits it (grok-build DEFAULT_CONTEXT_WINDOW). */
export const DEFAULT_CONTEXT_WINDOW = 256_000;

export { ZERO_COST, resolveXaiModelCost } from "./pricing";

export interface SessionAuthHeaders {
	accessToken: string;
	clientVersion: string;
	clientIdentifier: string;
	tokenAuthValue: string;
	clientModeValue: string;
	userId?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

function firstNumber(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
		if (typeof value === "string" && value.trim() !== "") {
			const n = Number(value);
			if (Number.isFinite(n) && n > 0) return n;
		}
	}
	return undefined;
}

function firstBool(obj: Record<string, unknown>, ...keys: string[]): boolean | undefined {
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === "boolean") return value;
	}
	return undefined;
}

/** Canonical effort token; `max` is a CLI/UX alias of `xhigh` (grok-build). */
export function parseReasoningEffortToken(token: string): ReasoningEffortWire | undefined {
	switch (token.toLowerCase()) {
		case "none":
			return "none";
		case "minimal":
			return "minimal";
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		case "xhigh":
		case "max":
			return "xhigh";
		default:
			return undefined;
	}
}

/**
 * Parse grok-build `reasoningEfforts` array: bare strings or `{ value }` tables.
 * Skips invalid entries (forward-compat). Returns undefined when empty/unusable.
 */
export function parseReasoningEffortOptions(raw: unknown): ReasoningEffortWire[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const out: ReasoningEffortWire[] = [];
	const seen = new Set<ReasoningEffortWire>();
	for (const el of raw) {
		let token: string | undefined;
		if (typeof el === "string") {
			token = el;
		} else if (isRecord(el) && typeof el.value === "string") {
			token = el.value;
		}
		if (!token) continue;
		const effort = parseReasoningEffortToken(token);
		if (!effort || seen.has(effort)) continue;
		seen.add(effort);
		out.push(effort);
	}
	return out.length > 0 ? out : undefined;
}

/**
 * Pi thinkingLevelMap for a model: offered efforts → wire string, else null.
 * Absent/empty efforts use the legacy low..xhigh menu.
 */
export function buildThinkingLevelMap(
	efforts: readonly ReasoningEffortWire[] = LEGACY_REASONING_EFFORTS,
): ThinkingLevelMap {
	const offered = new Set(efforts.length > 0 ? efforts : LEGACY_REASONING_EFFORTS);
	return {
		off: offered.has("none") ? "none" : null,
		minimal: offered.has("minimal") ? "minimal" : null,
		low: offered.has("low") ? "low" : null,
		medium: offered.has("medium") ? "medium" : null,
		high: offered.has("high") ? "high" : null,
		xhigh: offered.has("xhigh") ? "xhigh" : null,
	};
}

/** thinkingLevelMap for a catalog entry; undefined when effort is unsupported. */
export function thinkingLevelMapForCatalog(entry: CatalogModel): ThinkingLevelMap | undefined {
	if (!entry.reasoning) return undefined;
	return buildThinkingLevelMap(entry.reasoningEfforts ?? LEGACY_REASONING_EFFORTS);
}

function decodeBase64UrlJson(segment: string): unknown {
	const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((segment.length + 3) % 4);
	return JSON.parse(globalThis.atob(padded)) as unknown;
}

/** Unverified JWT claim peek for request attribution headers (not auth validation). */
export function peekJwtUserId(token: string): string | undefined {
	const parts = token.split(".");
	if (parts.length < 2 || !parts[1]) return undefined;
	try {
		const payload = decodeBase64UrlJson(parts[1]);
		if (!isRecord(payload)) return undefined;
		return firstString(payload, "sub") ?? firstString(payload, "user_id") ?? firstString(payload, "userId");
	} catch {
		return undefined;
	}
}

/**
 * Parse one OpenAI-compatible / grok-build remote model entry.
 * Filters `hidden` models; OAuth session auth keeps `supported_in_api: false`.
 */
export function parseRemoteModelEntry(value: unknown): CatalogModel | undefined {
	if (!isRecord(value)) return undefined;
	const meta = isRecord(value._meta) ? value._meta : undefined;

	const hidden = firstBool(value, "hidden") ?? (meta ? firstBool(meta, "hidden") : undefined) ?? false;
	if (hidden) return undefined;

	const id = firstString(value, "model", "modelId", "id") ?? (meta ? firstString(meta, "model", "modelId") : undefined);
	if (!id) return undefined;

	const name = firstString(value, "name") ?? id;
	const contextWindow =
		firstNumber(value, "contextWindow", "context_window") ??
		(meta ? firstNumber(meta, "contextWindow", "totalContextTokens") : undefined) ??
		DEFAULT_CONTEXT_WINDOW;

	const maxCompletion =
		firstNumber(value, "maxCompletionTokens", "max_completion_tokens") ??
		(meta ? firstNumber(meta, "maxCompletionTokens", "max_completion_tokens") : undefined);
	const maxTokens = maxCompletion ?? Math.min(contextWindow, 128_000);

	const reasoning =
		firstBool(value, "supportsReasoningEffort", "supports_reasoning_effort") ??
		(meta ? firstBool(meta, "supportsReasoningEffort", "supports_reasoning_effort") : undefined) ??
		false;

	const effortsRaw =
		value.reasoningEfforts ??
		value.reasoning_efforts ??
		(meta ? (meta.reasoningEfforts ?? meta.reasoning_efforts) : undefined);
	const reasoningEfforts = reasoning ? parseReasoningEffortOptions(effortsRaw) : undefined;

	return {
		id,
		name,
		reasoning,
		...(reasoningEfforts ? { reasoningEfforts } : {}),
		input: ["text", "image"],
		// Catalog has no unit prices; fill from official xAI docs prefab table.
		cost: resolveXaiModelCost(id),
		contextWindow,
		maxTokens,
	};
}

/** Parse `{ data: [...] }` from cli-chat-proxy / api.x.ai style list responses. */
export function parseRemoteModels(payload: unknown): CatalogModel[] {
	if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
	const models: CatalogModel[] = [];
	const seen = new Set<string>();
	for (const entry of payload.data) {
		const model = parseRemoteModelEntry(entry);
		if (!model || seen.has(model.id)) continue;
		seen.add(model.id);
		models.push(model);
	}
	return models;
}

export function isCatalogModel(value: unknown): value is CatalogModel {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		typeof value.reasoning === "boolean" &&
		Array.isArray(value.input) &&
		isRecord(value.cost) &&
		typeof value.contextWindow === "number" &&
		typeof value.maxTokens === "number"
	);
}

/** Sanitize a modelsCatalog field loaded from auth.json. */
export function sanitizeModelsCatalog(value: unknown): CatalogModel[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const models = value.filter(isCatalogModel).map((m) => {
		const reasoningEfforts = m.reasoning ? parseReasoningEffortOptions(m.reasoningEfforts) : undefined;
		return {
			id: m.id,
			name: m.name,
			reasoning: m.reasoning,
			...(reasoningEfforts ? { reasoningEfforts } : {}),
			input: m.input.filter((x): x is "text" | "image" => x === "text" || x === "image"),
			cost: {
				input: Number(m.cost.input) || 0,
				output: Number(m.cost.output) || 0,
				cacheRead: Number(m.cost.cacheRead) || 0,
				cacheWrite: Number(m.cost.cacheWrite) || 0,
			},
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
		};
	});
	return models.length > 0 ? models : undefined;
}

export function modelsListUrl(baseUrl: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/models`;
}

/** GET /v1/models with grok-build session-auth headers. */
export async function fetchModelsCatalog(
	baseUrl: string,
	headers: SessionAuthHeaders,
	signal?: AbortSignal,
): Promise<CatalogModel[]> {
	const userId = headers.userId ?? peekJwtUserId(headers.accessToken);
	const response = await globalThis.fetch(modelsListUrl(baseUrl), {
		method: "GET",
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${headers.accessToken}`,
			"X-XAI-Token-Auth": headers.tokenAuthValue,
			"x-grok-client-version": headers.clientVersion,
			"x-grok-client-identifier": headers.clientIdentifier,
			"x-grok-client-mode": headers.clientModeValue,
			...(userId ? { "x-userid": userId } : {}),
		},
		signal,
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`xAI models catalog request failed (${response.status})${detail ? `: ${detail}` : ""}`);
	}

	const payload: unknown = await response.json();
	return parseRemoteModels(payload);
}
