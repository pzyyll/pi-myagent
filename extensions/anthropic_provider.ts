import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const TARGET_PROVIDER = "ccswitch";
const TARGET_MODEL_PREFIX = "claude-";

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
		return {
			...event.payload,
			metadata: {
				...existing,
				user_id: buildUserId(ctx),
			},
		};
	});
}
