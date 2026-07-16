// ABOUTME: Registers a SuperGrok subscription OAuth provider separate from built-in xAI API keys.
// ABOUTME: Dynamically loads cli-chat-proxy /v1/models catalog (grok-build session auth path).
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { URLSearchParams } from "node:url";
import type { Api, Model, OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import {
	type CatalogModel,
	FALLBACK_CATALOG,
	fetchModelsCatalog,
	isRecord,
	peekJwtUserId,
	sanitizeModelsCatalog,
	thinkingLevelMapForCatalog,
} from "./catalog";

const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
// Resolve the installed grok CLI version so the proxy attributes requests to a
// real Grok Build client version. Falls back if grok isn't discoverable.
const GROK_VERSION_FALLBACK = "0.2.101";

function resolveGrokVersion(): string {
	const grokHome = process.env.GROK_HOME || join(homedir(), ".grok");
	const candidates = ["grok", join(grokHome, "bin", "grok")];
	for (const bin of candidates) {
		try {
			const out = execFileSync(bin, ["--version"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 5_000,
			});
			const match = out.match(/(\d+\.\d+\.\d+(?:-[^\s)]+)?)/);
			if (match) return match[1];
		} catch {
			// grok not found at this candidate path; try the next.
		}
	}
	return GROK_VERSION_FALLBACK;
}

const CLIENT_VERSION = resolveGrokVersion();
// pi renders the device code + URL in its TUI, matching grok-build's `Ui` surface.
const CLIENT_SURFACE = "ui";
// Match grok-build's client identifier so the proxy attributes traffic to the
// Grok CLI product (not a generic API client) for subscription gating.
const CLIENT_IDENTIFIER = "grok-shell";
const OAUTH_REFERRER = "grok-build";
// Subscription OAuth path only (matches grok-build session routing).
// Built-in Pi provider `xai` + XAI_API_KEY remains the public API-key path.
const PROVIDER_ID = "xai-supergrok";
const CLI_CHAT_PROXY_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
// Proxy-only headers injected when baseUrl is cli-chat-proxy.
const TOKEN_AUTH_HEADER = "X-XAI-Token-Auth";
const TOKEN_AUTH_VALUE = "xai-grok-cli";
const AUTHENTICATE_RESPONSE_HEADER = "x-authenticateresponse";
const AUTHENTICATE_RESPONSE_VALUE = "authenticate-response";
const CLIENT_MODE_HEADER = "x-grok-client-mode";
const CLIENT_MODE_VALUE = "interactive";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";
const DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code";
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
// Frozen xAI OAuth2 client scope contract (8 scopes) - server expects exactly this set.
const SCOPE = "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";

const DEVICE_CODE_DEFAULT_INTERVAL_MS = 5_000;
const DEVICE_CODE_MIN_INTERVAL_MS = 1_000;
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5_000;
const DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1000;
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000;
const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000;
// Align with grok-build Responses path (session OAuth → cli-chat-proxy):
// - system role only (no developer)
// - no OpenAI session_id header (sticky routing via x-grok-session-id)
// - never body prompt_cache_key / prompt_cache_retention (grok leaves both unset)
const XAI_RESPONSES_COMPAT = {
	supportsDeveloperRole: false,
	sessionAffinityFormat: "openai-nosession",
	supportsLongCacheRetention: false,
} as const;
const SESSION_ID_HEADER = "x-grok-session-id";
const MODEL_OVERRIDE_HEADER = "x-grok-model-override";
const USER_ID_HEADER = "x-grok-user-id";
// Match grok-build legacy effort menu (low..xhigh); none/minimal not offered in UI.

/** OAuth credentials plus the cached remote model catalog (Radius-style). */
type SuperGrokCredentials = OAuthCredentials & {
	modelsCatalog?: CatalogModel[];
};

interface XaiTokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	token_type?: string;
	scope?: string;
}

interface DeviceCodeResponse {
	device_code?: string;
	user_code?: string;
	verification_uri?: string;
	verification_uri_complete?: string;
	expires_in?: number;
	interval?: number;
}

interface DeviceTokenErrorBody {
	error?: string;
	error_description?: string;
}

function authHeaders() {
	return {
		"Content-Type": "application/x-www-form-urlencoded",
		Accept: "application/json",
		"x-grok-client-version": CLIENT_VERSION,
		"x-grok-client-surface": CLIENT_SURFACE,
	};
}

function positiveSecondsToMs(value: unknown, defaultMs: number): number {
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs;
}

function expiresAt(expiresInSeconds: unknown): number {
	const expiresMs = positiveSecondsToMs(expiresInSeconds, 3_600_000);
	return Math.max(Date.now(), Date.now() + expiresMs - ACCESS_TOKEN_REFRESH_SKEW_MS);
}

async function responseText(response: Response): Promise<string> {
	return response.text().catch(() => "");
}

async function parseJson<T>(response: Response): Promise<T> {
	return (await response.json()) as T;
}

async function requestDeviceCode(
	signal?: AbortSignal,
): Promise<Required<Pick<DeviceCodeResponse, "device_code" | "user_code" | "verification_uri">> & DeviceCodeResponse> {
	const response = await globalThis.fetch(DEVICE_AUTHORIZATION_URL, {
		method: "POST",
		headers: authHeaders(),
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			scope: SCOPE,
			referrer: OAUTH_REFERRER,
		}).toString(),
		signal,
	});

	if (!response.ok) {
		const detail = await responseText(response);
		throw new Error(`xAI device code request failed (${response.status})${detail ? `: ${detail}` : ""}`);
	}

	const json = await parseJson<DeviceCodeResponse>(response);
	if (!json.device_code || !json.user_code || !json.verification_uri) {
		throw new Error("xAI device code response is missing device_code / user_code / verification_uri");
	}

	return json as Required<Pick<DeviceCodeResponse, "device_code" | "user_code" | "verification_uri">> &
		DeviceCodeResponse;
}

async function parseDeviceTokenError(response: Response): Promise<DeviceTokenErrorBody> {
	return response.json().catch(() => ({})) as Promise<DeviceTokenErrorBody>;
}

function toLoginCredentials(tokens: XaiTokenResponse): OAuthCredentials {
	if (!tokens.access_token) throw new Error("xAI token response is missing access_token");
	if (!tokens.refresh_token) throw new Error("xAI token response is missing refresh_token");

	return {
		refresh: tokens.refresh_token,
		access: tokens.access_token,
		expires: expiresAt(tokens.expires_in),
	};
}

function getModelsCatalog(credentials: OAuthCredentials | undefined): CatalogModel[] | undefined {
	if (!credentials) return undefined;
	return sanitizeModelsCatalog((credentials as SuperGrokCredentials).modelsCatalog);
}

/**
 * Fetch remote catalog and attach it to credentials.
 * On failure, retain the previous catalog so models do not vanish (Radius pattern).
 */
async function attachModelsCatalog(
	credentials: OAuthCredentials,
	previous?: OAuthCredentials,
	signal?: AbortSignal,
): Promise<SuperGrokCredentials> {
	try {
		const modelsCatalog = await fetchModelsCatalog(
			CLI_CHAT_PROXY_BASE_URL,
			{
				accessToken: credentials.access,
				clientVersion: CLIENT_VERSION,
				clientIdentifier: CLIENT_IDENTIFIER,
				tokenAuthValue: TOKEN_AUTH_VALUE,
				clientModeValue: CLIENT_MODE_VALUE,
			},
			signal,
		);
		if (modelsCatalog.length > 0) {
			return { ...credentials, modelsCatalog };
		}
		const previousCatalog = getModelsCatalog(previous);
		if (previousCatalog) {
			return { ...credentials, modelsCatalog: previousCatalog };
		}
		// Empty remote list with no prior cache — keep the bake-in fallback so /model works.
		return { ...credentials, modelsCatalog: FALLBACK_CATALOG };
	} catch {
		const previousCatalog = getModelsCatalog(previous);
		if (previousCatalog) {
			return { ...credentials, modelsCatalog: previousCatalog };
		}
		// Initial login / no cache: keep bake-in fallback so /model still works.
		return { ...credentials, modelsCatalog: FALLBACK_CATALOG };
	}
}

async function pollDeviceCodeToken(device: DeviceCodeResponse, signal?: AbortSignal): Promise<XaiTokenResponse> {
	if (!device.device_code) throw new Error("xAI device code response is missing device_code");

	const expiresInMs = positiveSecondsToMs(device.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS);
	const deadline = Date.now() + expiresInMs;
	let intervalMs = Math.max(
		positiveSecondsToMs(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS),
		DEVICE_CODE_MIN_INTERVAL_MS,
	);

	while (Date.now() < deadline) {
		const response = await globalThis.fetch(TOKEN_URL, {
			method: "POST",
			headers: authHeaders(),
			body: new URLSearchParams({
				grant_type: DEVICE_CODE_GRANT_TYPE,
				client_id: CLIENT_ID,
				device_code: device.device_code,
			}).toString(),
			signal,
		});

		if (response.ok) return parseJson<XaiTokenResponse>(response);

		const body = await parseDeviceTokenError(response);
		const remaining = Math.max(0, deadline - Date.now());

		if (body.error === "authorization_pending") {
			await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining), undefined, { signal });
			continue;
		}

		if (body.error === "slow_down") {
			intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS;
			await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining), undefined, { signal });
			continue;
		}

		if (body.error === "access_denied" || body.error === "authorization_denied") {
			throw new Error("xAI device authorization was denied");
		}

		if (body.error === "expired_token") {
			throw new Error("xAI device code expired - please re-run login");
		}

		const detail = body.error_description ?? body.error ?? "";
		throw new Error(`xAI device token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`);
	}

	throw new Error("xAI device authorization timed out");
}

async function loginXai(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const device = await requestDeviceCode(callbacks.signal);
	callbacks.onDeviceCode({
		userCode: device.user_code,
		verificationUri: device.verification_uri,
		intervalSeconds: positiveSecondsToMs(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS) / 1000,
		expiresInSeconds: positiveSecondsToMs(device.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS) / 1000,
	});

	const tokens = await pollDeviceCodeToken(device, callbacks.signal);
	const credentials = toLoginCredentials(tokens);
	return attachModelsCatalog(credentials, undefined, callbacks.signal);
}

async function refreshAccessToken(refreshToken: string, signal?: AbortSignal): Promise<XaiTokenResponse> {
	const response = await globalThis.fetch(TOKEN_URL, {
		method: "POST",
		headers: authHeaders(),
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}).toString(),
		signal,
	});

	if (!response.ok) {
		const detail = await responseText(response);
		throw new Error(`xAI token refresh failed (${response.status})${detail ? `: ${detail}` : ""}`);
	}

	return parseJson<XaiTokenResponse>(response);
}

async function refreshXaiToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	const tokens = await refreshAccessToken(credentials.refresh);
	if (!tokens.access_token) throw new Error("xAI token refresh response is missing access_token");

	const refreshed: OAuthCredentials = {
		...credentials,
		access: tokens.access_token,
		refresh: tokens.refresh_token ?? credentials.refresh,
		expires: expiresAt(tokens.expires_in),
	};
	return attachModelsCatalog(refreshed, credentials);
}

/**
 * Strip OpenAI-style cache fields pi-ai may inject.
 * grok-build CreateResponse leaves prompt_cache_key / prompt_cache_retention as None
 * and always sets reasoning.summary = concise (effort may be unset).
 */
export function alignGrokBuildResponsesPayload(payload: unknown): unknown {
	if (!isRecord(payload)) return payload;

	const next: Record<string, unknown> = { ...payload };
	delete next.prompt_cache_key;
	delete next.prompt_cache_retention;

	// Match ConversationRequest → CreateResponse: always send reasoning with concise summary.
	if (isRecord(next.reasoning)) {
		next.reasoning = {
			...next.reasoning,
			summary: "concise",
		};
	} else {
		next.reasoning = { summary: "concise" };
	}

	return next;
}

/** Product headers grok-build attaches on every sampling request. */
export function applyGrokBuildProductHeaders(
	headers: Record<string, string | null>,
	opts: { sessionId?: string; modelId?: string; accessToken?: string },
): void {
	if (opts.sessionId) {
		headers[SESSION_ID_HEADER] = opts.sessionId;
	}
	if (opts.modelId) {
		headers[MODEL_OVERRIDE_HEADER] = opts.modelId;
	}
	if (opts.accessToken) {
		const userId = peekJwtUserId(opts.accessToken);
		if (userId) headers[USER_ID_HEADER] = userId;
	}
}

function isCliChatProxyUrl(url: string | undefined): boolean {
	if (!url) return false;
	try {
		return new URL(url).host === "cli-chat-proxy.grok.com";
	} catch {
		return url.includes("cli-chat-proxy.grok.com");
	}
}

/**
 * Shared catalog → model field mapping (compat + reasoning levels).
 * Used for both registry seed configs and oauth.modifyModels Model objects.
 */
function catalogModelFields(entry: CatalogModel) {
	return {
		id: entry.id,
		name: entry.name,
		reasoning: entry.reasoning,
		thinkingLevelMap: thinkingLevelMapForCatalog(entry),
		input: [...entry.input] as Array<"text" | "image">,
		cost: { ...entry.cost },
		contextWindow: entry.contextWindow,
		maxTokens: entry.maxTokens,
		compat: XAI_RESPONSES_COMPAT,
	};
}

/** ProviderModelConfig seed entry so Pi 0.80.7 enters the models + modifyModels path. */
export function catalogToProviderModelConfig(entry: CatalogModel): ProviderModelConfig {
	return catalogModelFields(entry);
}

/** Full Model used by oauth.modifyModels when swapping in the credential catalog. */
export function catalogToModel(entry: CatalogModel): Model<Api> {
	return {
		...catalogModelFields(entry),
		api: "openai-responses",
		provider: PROVIDER_ID,
		baseUrl: CLI_CHAT_PROXY_BASE_URL,
	};
}

/**
 * Non-empty seed from FALLBACK_CATALOG.
 * Pi skips oauth.modifyModels when registerProvider is given models: [] (0.80.7
 * applyProviderConfig only runs the models + modifyModels branch when length > 0).
 * Remote catalog on credentials still replaces this seed via modifyModels.
 */
export const SEED_MODELS: ProviderModelConfig[] = FALLBACK_CATALOG.map(catalogToProviderModelConfig);

/**
 * Replace this provider's models with the credential-cached remote catalog.
 * Mirrors Radius gateway OAuth: catalog lives on credentials; baseUrl stays cli-chat-proxy.
 * Falls back to FALLBACK_CATALOG when credentials have no usable modelsCatalog.
 */
export function modifyXaiModelsForOAuth(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[] {
	const others = models.filter((model) => model.provider !== PROVIDER_ID);
	const catalog = getModelsCatalog(credentials) ?? FALLBACK_CATALOG;
	return [...others, ...catalog.map(catalogToModel)];
}

export { PROVIDER_ID, FALLBACK_CATALOG };

/** Background refresh so existing logins without modelsCatalog get a real list. */
async function refreshCatalogInBackground(ctx: ExtensionContext): Promise<void> {
	const cred = ctx.modelRegistry.authStorage.get(PROVIDER_ID);
	if (!cred || cred.type !== "oauth") return;

	try {
		const updated = await attachModelsCatalog(cred, cred);
		const nextCatalog = getModelsCatalog(updated);
		const prevCatalog = getModelsCatalog(cred);
		const changed =
			JSON.stringify(nextCatalog?.map((m) => m.id) ?? []) !== JSON.stringify(prevCatalog?.map((m) => m.id) ?? []);

		ctx.modelRegistry.authStorage.set(PROVIDER_ID, { ...updated, type: "oauth" });
		if (changed || !prevCatalog) {
			ctx.modelRegistry.refresh();
		}
	} catch {
		// Keep whatever catalog/fallback is already on disk.
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider(PROVIDER_ID, {
		name: "xAI SuperGrok",
		// Subscription OAuth only — does not share credentials with built-in `xai` / XAI_API_KEY.
		baseUrl: CLI_CHAT_PROXY_BASE_URL,
		api: "openai-responses",
		// Non-empty seed required so Pi 0.80.7 runs models registration + oauth.modifyModels.
		// Credential-cached remote catalog replaces the seed; FALLBACK_CATALOG if none/unavailable.
		models: SEED_MODELS,
		oauth: {
			name: "xAI SuperGrok (Subscription OAuth)",
			login: loginXai,
			refreshToken: refreshXaiToken,
			getApiKey: (credentials) => credentials.access,
			modifyModels: modifyXaiModelsForOAuth,
		},
	});

	// Upgrade old auth.json entries that predate modelsCatalog, and refresh entitlements.
	pi.on("session_start", (_event, ctx) => {
		void refreshCatalogInBackground(ctx);
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_ID) return;
		return alignGrokBuildResponsesPayload(event.payload);
	});

	pi.on("before_provider_headers", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_ID) return;
		event.headers["x-grok-client-version"] = CLIENT_VERSION;
		event.headers["x-grok-client-identifier"] = CLIENT_IDENTIFIER;

		const cred = ctx.modelRegistry.authStorage.get(PROVIDER_ID);
		const accessToken = cred?.type === "oauth" ? cred.access : undefined;
		applyGrokBuildProductHeaders(event.headers, {
			sessionId: ctx.sessionManager.getSessionId(),
			modelId: ctx.model.id,
			accessToken,
		});

		// cli-chat-proxy requires these product/auth attribution headers.
		if (isCliChatProxyUrl(ctx.model.baseUrl)) {
			event.headers[TOKEN_AUTH_HEADER] = TOKEN_AUTH_VALUE;
			event.headers[AUTHENTICATE_RESPONSE_HEADER] = AUTHENTICATE_RESPONSE_VALUE;
			event.headers[CLIENT_MODE_HEADER] = CLIENT_MODE_VALUE;
		}
	});
}
