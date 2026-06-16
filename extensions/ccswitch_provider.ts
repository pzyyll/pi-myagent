import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ProviderConfig } from "@earendil-works/pi-coding-agent";

const TARGET_PROVIDER = "ccswitch";
const TARGET_MODEL_PREFIX = "claude-";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const SYSTEM_PREFIX = [
	{
		type: "text",
		text: "x-anthropic-billing-header: cc_version=2.1.177.79a; cc_entrypoint=cli; cch=000000;",
	},
	{
		type: "text",
		text: "You are Claude Code, Anthropic's official CLI for Claude.",
		cache_control: { type: "ephemeral" },
	},
];

const PROVIDER_CONFIG: ProviderConfig = {
	baseUrl: "http://127.0.0.1:15721",
	apiKey: TARGET_PROVIDER,
	api: "anthropic-messages",
	headers: {
		"User-Agent": "claude-cli/2.1.177 (external, cli)",
		"anthropic-beta":
			"claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,context-management-2025-06-27,prompt-caching-scope-2026-01-05,effort-2025-11-24",
	},
	models: [
		{
			id: "claude-opus-4-8",
			name: "claude-opus-4-8",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 1000000,
			maxTokens: 128000,
			thinkingLevelMap: { xhigh: "xhigh" },
			cost: ZERO_COST,
			compat: { forceAdaptiveThinking: true, supportsTemperature: false, sendSessionIdHeader: true },
		},
		{
			id: "claude-sonnet-4-6",
			name: "claude-sonnet-4-6",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 1000000,
			maxTokens: 64000,
			cost: ZERO_COST,
			compat: { forceAdaptiveThinking: true, sendSessionIdHeader: true },
		},
		{
			id: "claude-haiku-4-5-20251001",
			name: "claude-haiku-4-5-20251001",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 200000,
			maxTokens: 64000,
			cost: ZERO_COST,
			compat: { sendSessionIdHeader: true },
		},
	],
};

interface ClaudeIdentity {
	deviceId: string;
	accountUuid: string;
}

let cachedIdentity: ClaudeIdentity | undefined;

function readClaudeConfig(): { userID?: string; accountUuid?: string } {
	try {
		const raw = readFileSync(join(homedir(), ".claude.json"), "utf8");
		const parsed = JSON.parse(raw) as { userID?: unknown; oauthAccount?: { accountUuid?: unknown } };
		const userID = typeof parsed.userID === "string" ? parsed.userID : undefined;
		const accountUuid =
			typeof parsed.oauthAccount?.accountUuid === "string" ? parsed.oauthAccount.accountUuid : undefined;
		return { userID, accountUuid };
	} catch {
		return {};
	}
}

function resolveIdentity(): ClaudeIdentity {
	if (cachedIdentity) return cachedIdentity;
	const config = readClaudeConfig();
	cachedIdentity = {
		deviceId: config.userID || randomBytes(32).toString("hex"),
		accountUuid: config.accountUuid ?? "",
	};
	return cachedIdentity;
}

function buildUserId(ctx: ExtensionContext): string {
	const { deviceId, accountUuid } = resolveIdentity();
	return JSON.stringify({
		device_id: deviceId,
		account_uuid: accountUuid,
		session_id: ctx.sessionManager.getSessionId(),
	});
}

function shouldInject(ctx: ExtensionContext): boolean {
	const model = ctx.model;
	return model?.provider === TARGET_PROVIDER && model.id.startsWith(TARGET_MODEL_PREFIX);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event, ctx) => {
		if (!shouldInject(ctx) || !isPlainObject(event.payload)) return;

		const existing = isPlainObject(event.payload.metadata) ? event.payload.metadata : {};
		const existingSystem = Array.isArray(event.payload.system) ? event.payload.system : [];
		return {
			...event.payload,
			system: [...SYSTEM_PREFIX, ...existingSystem],
			metadata: {
				...existing,
				user_id: buildUserId(ctx),
			},
			context_management: {
				edits: [
					{
						keep: "all",
						type: "clear_thinking_20251015",
					},
				],
			},
		};
	});

	pi.registerProvider(TARGET_PROVIDER, PROVIDER_CONFIG);
}
