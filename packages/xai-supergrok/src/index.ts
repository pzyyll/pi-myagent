// ABOUTME: Registers SuperGrok device-code OAuth for Pi's built-in xAI provider.
// ABOUTME: Uses OpenAI Responses models for xAI while preserving API-key fallback.
import { setTimeout as sleep } from "node:timers/promises";
import { URLSearchParams } from "node:url";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_BASE_URL = "https://api.x.ai/v1";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";
const DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code";
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const SCOPE = "openid profile email offline_access grok-cli:access api:access";

const DEVICE_CODE_DEFAULT_INTERVAL_MS = 5_000;
const DEVICE_CODE_MIN_INTERVAL_MS = 1_000;
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5_000;
const DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1000;
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000;
const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000;
const XAI_RESPONSES_COMPAT = {
	supportsDeveloperRole: false,
	sendSessionIdHeader: false,
	supportsLongCacheRetention: false,
};
const XAI_REASONING_LEVELS = { off: null, minimal: null } satisfies ProviderModelConfig["thinkingLevelMap"];

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

function xaiModel(model: Omit<ProviderModelConfig, "api" | "compat" | "thinkingLevelMap">): ProviderModelConfig {
	return {
		...model,
		api: "openai-responses",
		thinkingLevelMap: model.reasoning ? XAI_REASONING_LEVELS : undefined,
		input: [...model.input],
		cost: { ...model.cost },
		compat: XAI_RESPONSES_COMPAT,
	};
}

const XAI_MODELS: ProviderModelConfig[] = [
	xaiModel({
		id: "grok-3",
		name: "Grok 3",
		reasoning: false,
		input: ["text"],
		cost: { input: 3, output: 15, cacheRead: 0.75, cacheWrite: 0 },
		contextWindow: 131_072,
		maxTokens: 8192,
	}),
	xaiModel({
		id: "grok-3-fast",
		name: "Grok 3 Fast",
		reasoning: false,
		input: ["text"],
		cost: { input: 5, output: 25, cacheRead: 1.25, cacheWrite: 0 },
		contextWindow: 131_072,
		maxTokens: 8192,
	}),
	xaiModel({
		id: "grok-4.20-0309-non-reasoning",
		name: "Grok 4.20 (Non-Reasoning)",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 30_000,
	}),
	xaiModel({
		id: "grok-4.20-0309-reasoning",
		name: "Grok 4.20 (Reasoning)",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 30_000,
	}),
	xaiModel({
		id: "grok-4.3",
		name: "Grok 4.3",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 30_000,
	}),
	xaiModel({
		id: "grok-4.5",
		name: "Grok 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 500_000,
		maxTokens: 30_000,
	}),
	xaiModel({
		id: "grok-build-0.1",
		name: "Grok Build 0.1",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0 },
		contextWindow: 256_000,
		maxTokens: 256_000,
	}),
	xaiModel({
		id: "grok-code-fast-1",
		name: "Grok Code Fast 1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.2, output: 1.5, cacheRead: 0.02, cacheWrite: 0 },
		contextWindow: 32_768,
		maxTokens: 8192,
	}),
];

function xaiModels(): ProviderModelConfig[] {
	return XAI_MODELS.map((model) => ({
		...model,
		input: [...model.input],
		cost: { ...model.cost },
	}));
}

function authHeaders() {
	return {
		"Content-Type": "application/x-www-form-urlencoded",
		Accept: "application/json",
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
	return toLoginCredentials(tokens);
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

	return {
		...credentials,
		access: tokens.access_token,
		refresh: tokens.refresh_token ?? credentials.refresh,
		expires: expiresAt(tokens.expires_in),
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider("xai", {
		baseUrl: XAI_BASE_URL,
		apiKey: "$XAI_API_KEY",
		api: "openai-responses",
		models: xaiModels(),
		oauth: {
			name: "xAI Grok OAuth (SuperGrok)",
			login: loginXai,
			refreshToken: refreshXaiToken,
			getApiKey: (credentials) => credentials.access,
		},
	});
}
