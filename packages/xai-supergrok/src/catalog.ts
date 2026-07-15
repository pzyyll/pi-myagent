// ABOUTME: Fetches and parses the SuperGrok cli-chat-proxy /v1/models catalog.
// ABOUTME: Mirrors grok-build session-auth model listing for OAuth credential storage.

/** Serializable model entry cached on OAuth credentials. */
export interface CatalogModel {
	id: string;
	name: string;
	reasoning: boolean;
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
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 500_000,
		maxTokens: 128_000,
	},
	{
		id: "grok-build",
		name: "Grok Build",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 500_000,
		maxTokens: 128_000,
	},
];

/** Default context window when the remote entry omits it (grok-build DEFAULT_CONTEXT_WINDOW). */
export const DEFAULT_CONTEXT_WINDOW = 256_000;

const ZERO_COST: CatalogModel["cost"] = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
};

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

	return {
		id,
		name,
		reasoning,
		input: ["text", "image"],
		cost: { ...ZERO_COST },
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
	const models = value.filter(isCatalogModel).map((m) => ({
		...m,
		input: m.input.filter((x): x is "text" | "image" => x === "text" || x === "image"),
		cost: {
			input: Number(m.cost.input) || 0,
			output: Number(m.cost.output) || 0,
			cacheRead: Number(m.cost.cacheRead) || 0,
			cacheWrite: Number(m.cost.cacheWrite) || 0,
		},
	}));
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
