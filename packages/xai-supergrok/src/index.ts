// ABOUTME: Registers a SuperGrok subscription OAuth provider separate from built-in xAI API keys.
// ABOUTME: Pi owns auth in ~/.pi/agent/auth.json; ~/.grok/auth.json is optional manual import only.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { URLSearchParams } from "node:url";
import type { Api, Model, OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import {
	type CatalogModel,
	FALLBACK_CATALOG,
	fetchModelsCatalogDetailed,
	isAlwaysOnReasoningModel,
	isRecord,
	modelsListUrl,
	peekJwtUserId,
	thinkingLevelMapForCatalog,
} from "./catalog";
import {
	credentialsFromTokens,
	describeGrokAuthSession,
	EARLY_INVALIDATION_MS,
	importCredentialsFromGrokAuth,
	type SuperGrokCredentials,
} from "./grok-auth";
import { loadModelsCatalogFromCache, saveModelsCatalogToCache } from "./models-cache";
import { grokHome, OIDC_CLIENT_ID, OIDC_ISSUER } from "./paths";

const CLIENT_ID = OIDC_CLIENT_ID;
// Resolve the installed grok CLI version so the proxy attributes requests to a
// real Grok Build client version. Falls back if grok isn't discoverable.
const GROK_VERSION_FALLBACK = "0.2.101";

function resolveGrokVersion(): string {
	const home = grokHome();
	const candidates = ["grok", `${home}/bin/grok`];
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
const MODELS_ORIGIN = modelsListUrl(CLI_CHAT_PROXY_BASE_URL);
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

/** Pi `expires` = hard expiry minus grok-build early-invalidation buffer. */
function expiresAt(expiresInSeconds: unknown): number {
	const expiresMs = positiveSecondsToMs(expiresInSeconds, 3_600_000);
	return Math.max(Date.now(), Date.now() + expiresMs - EARLY_INVALIDATION_MS);
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

function toLoginCredentials(tokens: XaiTokenResponse): SuperGrokCredentials {
	if (!tokens.access_token) throw new Error("xAI token response is missing access_token");
	if (!tokens.refresh_token) throw new Error("xAI token response is missing refresh_token");

	// Pi-only: never write ~/.grok/auth.json.
	return credentialsFromTokens(
		{
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresInSeconds: typeof tokens.expires_in === "number" ? tokens.expires_in : undefined,
		},
		{ kind: "login" },
	);
}

/**
 * Never persist ModelsCatalog on Pi OAuth credentials / auth.json.
 * Catalog lives only in ~/.pi/agent/grok_models_cache.json.
 */
export function credentialsWithoutModelsCatalog(credentials: OAuthCredentials): SuperGrokCredentials {
	const rest = { ...(credentials as SuperGrokCredentials & { modelsCatalog?: unknown }) };
	delete rest.modelsCatalog;
	return rest;
}

/**
 * Resolve ModelsCatalog for this provider (disk only).
 * Primary: ~/.pi/agent/grok_models_cache.json. Warm-start: ~/.grok/models_cache.json.
 * Never reads models catalog from Pi auth.json / OAuth credentials.
 */
export function getModelsCatalog(): CatalogModel[] | undefined {
	const cached = loadModelsCatalogFromCache({
		expectedOrigin: MODELS_ORIGIN,
	});
	return cached?.models.length ? cached.models : undefined;
}

/**
 * Fetch remote catalog and persist to ~/.pi/agent/grok_models_cache.json.
 * Returns credentials unchanged (no modelsCatalog field) so Pi auth.json stays token-only.
 */
async function refreshModelsCache(credentials: OAuthCredentials, signal?: AbortSignal): Promise<SuperGrokCredentials> {
	const clean = credentialsWithoutModelsCatalog(credentials);
	const previousCache = loadModelsCatalogFromCache({
		expectedOrigin: MODELS_ORIGIN,
	});

	try {
		const result = await fetchModelsCatalogDetailed(
			CLI_CHAT_PROXY_BASE_URL,
			{
				accessToken: clean.access,
				clientVersion: CLIENT_VERSION,
				clientIdentifier: CLIENT_IDENTIFIER,
				tokenAuthValue: TOKEN_AUTH_VALUE,
				clientModeValue: CLIENT_MODE_VALUE,
				userId: clean.userId,
			},
			signal,
			{ etag: previousCache?.etag },
		);

		if (result.notModified && previousCache?.models.length) {
			// Renew TTL by rewriting with current models + etag.
			saveModelsCatalogToCache(previousCache.models, {
				origin: result.origin,
				grokVersion: CLIENT_VERSION,
				authMethod: "session",
				etag: result.etag ?? previousCache.etag,
				baseUrl: CLI_CHAT_PROXY_BASE_URL,
			});
			return clean;
		}

		if (result.models.length > 0) {
			saveModelsCatalogToCache(result.models, {
				origin: result.origin,
				grokVersion: CLIENT_VERSION,
				authMethod: "session",
				etag: result.etag,
				rawEntries: result.rawEntries,
				baseUrl: CLI_CHAT_PROXY_BASE_URL,
			});
			return clean;
		}

		if (previousCache?.models.length) {
			return clean;
		}
		// Empty remote list with no prior cache — keep the bake-in fallback so /model works.
		saveModelsCatalogToCache(FALLBACK_CATALOG, {
			origin: MODELS_ORIGIN,
			grokVersion: CLIENT_VERSION,
			authMethod: "session",
			baseUrl: CLI_CHAT_PROXY_BASE_URL,
		});
		return clean;
	} catch {
		if (previousCache?.models.length) {
			return clean;
		}
		saveModelsCatalogToCache(FALLBACK_CATALOG, {
			origin: MODELS_ORIGIN,
			grokVersion: CLIENT_VERSION,
			authMethod: "session",
			baseUrl: CLI_CHAT_PROXY_BASE_URL,
		});
		return clean;
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

async function loginWithDeviceCode(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const device = await requestDeviceCode(callbacks.signal);
	callbacks.onDeviceCode({
		userCode: device.user_code,
		verificationUri: device.verification_uri,
		intervalSeconds: positiveSecondsToMs(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS) / 1000,
		expiresInSeconds: positiveSecondsToMs(device.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS) / 1000,
	});

	const tokens = await pollDeviceCodeToken(device, callbacks.signal);
	const credentials = toLoginCredentials(tokens);
	return refreshModelsCache(credentials, callbacks.signal);
}

/**
 * /login xai-supergrok:
 * - If ~/.grok/auth.json has a session, let the user import it (one-shot copy into Pi auth)
 *   or start a fresh device-code OAuth login.
 * - Never auto-import on session start, and never write back to ~/.grok/auth.json.
 */
async function loginXai(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const fromGrok = importCredentialsFromGrokAuth();
	if (fromGrok) {
		const choice = await callbacks.onSelect({
			message: "xAI SuperGrok login method:",
			options: [
				{
					id: "import-grok",
					label: `Import from ~/.grok/auth.json (${describeGrokAuthSession(fromGrok)})`,
				},
				{
					id: "oauth",
					label: "OAuth device login (new session)",
				},
			],
		});
		if (!choice) throw new Error("Login cancelled");
		if (choice === "import-grok") {
			return refreshModelsCache(fromGrok, callbacks.signal);
		}
	}

	return loginWithDeviceCode(callbacks);
}

async function refreshAccessToken(
	refreshToken: string,
	opts?: { principalType?: string; principalId?: string; signal?: AbortSignal },
): Promise<XaiTokenResponse> {
	const params = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		client_id: CLIENT_ID,
	});
	// grok-build includes principal_* when present (team OAuth).
	if (opts?.principalType) params.set("principal_type", opts.principalType);
	if (opts?.principalId) params.set("principal_id", opts.principalId);

	const response = await globalThis.fetch(TOKEN_URL, {
		method: "POST",
		headers: authHeaders(),
		body: params.toString(),
		signal: opts?.signal,
	});

	if (!response.ok) {
		const detail = await responseText(response);
		throw new Error(`xAI token refresh failed (${response.status})${detail ? `: ${detail}` : ""}`);
	}

	return parseJson<XaiTokenResponse>(response);
}

async function refreshXaiToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	// Pi-owned refresh only — do not read/write ~/.grok/auth.json.
	const current = credentials as SuperGrokCredentials;
	const refreshToken = current.refresh;
	if (!refreshToken) throw new Error("xAI token refresh requires a refresh_token");

	const tokens = await refreshAccessToken(refreshToken, {
		principalType: current.principalType,
		principalId: current.principalId,
	});
	if (!tokens.access_token) throw new Error("xAI token refresh response is missing access_token");

	const refreshed = credentialsFromTokens(
		{
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token ?? refreshToken,
			expiresInSeconds: typeof tokens.expires_in === "number" ? tokens.expires_in : undefined,
		},
		{ kind: "refresh", previousCredentials: current },
	);

	if (!refreshed.expires) {
		refreshed.expires = expiresAt(tokens.expires_in);
	}

	return refreshModelsCache(refreshed);
}

/**
 * Strip OpenAI-style cache fields pi-ai may inject.
 * grok-build CreateResponse leaves prompt_cache_key / prompt_cache_retention as None
 * and always sets reasoning.summary = concise (effort may be unset).
 *
 * Always-on models (composer-2.5) reject explicit effort the same way
 * supportsReasoningEffort=false models do — strip effort so only summary remains.
 */
export function alignGrokBuildResponsesPayload(payload: unknown, opts?: { modelId?: string }): unknown {
	if (!isRecord(payload)) return payload;

	const next: Record<string, unknown> = { ...payload };
	delete next.prompt_cache_key;
	delete next.prompt_cache_retention;

	const stripEffort = opts?.modelId ? isAlwaysOnReasoningModel(opts.modelId) : false;

	// Match ConversationRequest → CreateResponse: always send reasoning with concise summary.
	if (isRecord(next.reasoning)) {
		const reasoning: Record<string, unknown> = {
			...next.reasoning,
			summary: "concise",
		};
		if (stripEffort) delete reasoning.effort;
		next.reasoning = reasoning;
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
 * Disk cache / remote catalog replaces this seed via modifyModels.
 */
export const SEED_MODELS: ProviderModelConfig[] = FALLBACK_CATALOG.map(catalogToProviderModelConfig);

/**
 * Replace this provider's models with the disk-cached remote catalog.
 * Mirrors Radius gateway OAuth, but catalog lives in ~/.pi/agent/grok_models_cache.json.
 * Falls back to FALLBACK_CATALOG when the cache is empty/unavailable.
 */
export function modifyXaiModelsForOAuth(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[] {
	void credentials; // Pi oauth.modifyModels signature; ModelsCatalog is disk-only.
	const others = models.filter((model) => model.provider !== PROVIDER_ID);
	const catalog = getModelsCatalog() ?? FALLBACK_CATALOG;
	return [...others, ...catalog.map(catalogToModel)];
}

export { PROVIDER_ID, FALLBACK_CATALOG, OIDC_ISSUER, OIDC_CLIENT_ID };

function storeProviderOAuth(ctx: ExtensionContext, credentials: OAuthCredentials): void {
	ctx.modelRegistry.authStorage.set(PROVIDER_ID, {
		...credentialsWithoutModelsCatalog(credentials),
		type: "oauth",
	});
}

/** Drop legacy modelsCatalog blobs from Pi auth.json (catalog is disk-cache only). */
function stripLegacyModelsCatalog(ctx: ExtensionContext): boolean {
	const existing = ctx.modelRegistry.authStorage.get(PROVIDER_ID);
	if (existing?.type !== "oauth") return false;
	if (!Object.prototype.hasOwnProperty.call(existing, "modelsCatalog")) return false;
	storeProviderOAuth(ctx, existing);
	return true;
}

/** Background refresh so disk cache / entitlements stay current. */
async function refreshCatalogInBackground(ctx: ExtensionContext): Promise<void> {
	const cred = ctx.modelRegistry.authStorage.get(PROVIDER_ID);
	if (!cred || cred.type !== "oauth") return;

	const before = getModelsCatalog()?.map((m) => m.id) ?? [];

	try {
		if (Object.prototype.hasOwnProperty.call(cred, "modelsCatalog")) {
			storeProviderOAuth(ctx, cred);
		}
		await refreshModelsCache(cred);
		const after = getModelsCatalog()?.map((m) => m.id) ?? [];
		const changed = JSON.stringify(before) !== JSON.stringify(after);
		if (changed || before.length === 0) {
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
		// Disk-cached remote catalog replaces the seed; FALLBACK_CATALOG if none/unavailable.
		models: SEED_MODELS,
		oauth: {
			name: "xAI SuperGrok (Subscription OAuth)",
			login: loginXai,
			refreshToken: refreshXaiToken,
			getApiKey: (credentials) => credentials.access,
			modifyModels: modifyXaiModelsForOAuth,
		},
	});

	// No auto-import of ~/.grok/auth.json — use /login xai-supergrok to import or OAuth.
	pi.on("session_start", (_event, ctx) => {
		if (stripLegacyModelsCatalog(ctx)) {
			ctx.modelRegistry.refresh();
		}
		void refreshCatalogInBackground(ctx);
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_ID) return;
		return alignGrokBuildResponsesPayload(event.payload, { modelId: ctx.model.id });
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
