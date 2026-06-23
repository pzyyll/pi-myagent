import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import { CONFIG_DIR_NAME, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_MAX_LENGTH = 40;
const DEFAULT_STYLE: NamingStyle = "concise";
const DEFAULT_MIN_USER_CHARS = 8;

type NamingStyle = "concise" | "descriptive";

interface AutoNameSettings {
	enabled: boolean;
	maxLength: number;
	style: NamingStyle;
	prompt?: string;
	model?: string;
}

const DEFAULT_PROMPTS: Record<NamingStyle, string> = {
	concise:
		"Generate a short title (max {max} characters) summarizing the user's intent in this conversation. " +
		"Use the same language as the user. Return ONLY the title, no quotes, no punctuation at the end, no explanation.",
	descriptive:
		"Generate a descriptive title (max {max} characters) capturing the topic and outcome of this conversation. " +
		"Use the same language as the user. Return ONLY the title, no quotes, no trailing punctuation, no explanation.",
};

const inflight = new WeakSet<object>();
const triedSessions = new Set<string>();

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		// New session context — clear any cached attempt records to allow naming again.
		triedSessions.clear();
	});

	pi.on("agent_end", async (_event, ctx) => {
		const settings = loadSettings();
		if (!settings.enabled) return;
		if (pi.getSessionName()) return;

		const sessionKey = sessionTriedKey(ctx);
		if (sessionKey && triedSessions.has(sessionKey)) return;

		const branch = ctx.sessionManager.getBranch();
		const conversation = collectConversation(branch);
		if (!isReady(conversation)) return;

		if (sessionKey) triedSessions.add(sessionKey);
		await runNaming(pi, ctx, settings, conversation);
	});

	pi.registerCommand("auto-name", {
		description: "Force regenerate the session name from the current conversation",
		handler: async (_args, ctx) => {
			const settings = loadSettings();
			const branch = ctx.sessionManager.getBranch();
			const conversation = collectConversation(branch);
			if (!isReady(conversation)) {
				if (ctx.hasUI) ctx.ui.notify("Not enough conversation yet to summarize", "warning");
				return;
			}
			await runNaming(pi, ctx, { ...settings, enabled: true }, conversation);
		},
	});
}

interface Conversation {
	userText: string;
	assistantText: string;
	combined: string;
}

function collectConversation(entries: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>): Conversation {
	const userParts: string[] = [];
	const assistantParts: string[] = [];

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (!("role" in msg)) continue;
		if (msg.role === "user") userParts.push(extractText(msg));
		else if (msg.role === "assistant") assistantParts.push(extractText(msg));
	}

	const userText = userParts.join("\n").trim();
	const assistantText = assistantParts.join("\n").trim();
	const combined = [userText && `User:\n${userText}`, assistantText && `Assistant:\n${assistantText}`]
		.filter(Boolean)
		.join("\n\n");
	return { userText, assistantText, combined };
}

function isReady(c: Conversation): boolean {
	return c.userText.length >= DEFAULT_MIN_USER_CHARS && c.assistantText.length > 0;
}

function extractText(message: AgentMessage): string {
	if (!("role" in message)) return "";
	if (message.role !== "user" && message.role !== "assistant") return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const out: string[] = [];
	for (const part of content) {
		if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
			const text = (part as { text?: unknown }).text;
			if (typeof text === "string") out.push(text);
		}
	}
	return out.join("\n");
}

function resolveModel(ctx: ExtensionContext, settings: AutoNameSettings): Model<any> | undefined {
	if (settings.model) {
		const slashIdx = settings.model.indexOf("/");
		if (slashIdx > 0 && slashIdx < settings.model.length - 1) {
			const provider = settings.model.slice(0, slashIdx);
			const modelId = settings.model.slice(slashIdx + 1);
			const customModel = ctx.modelRegistry.find(provider, modelId);
			if (customModel) return customModel;
			if (ctx.hasUI) {
				ctx.ui.notify(`auto-session-name: model "${settings.model}" not found, using active model`, "warning");
			}
		}
	}
	return ctx.model;
}

async function runNaming(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	settings: AutoNameSettings,
	conversation: Conversation,
): Promise<void> {
	const model = resolveModel(ctx, settings);
	if (!model) {
		if (ctx.hasUI) ctx.ui.notify("auto-session-name: no active model", "warning");
		return;
	}

	const guard = model as unknown as object;
	if (inflight.has(guard)) return;
	inflight.add(guard);

	try {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) {
			if (ctx.hasUI) ctx.ui.notify("auto-session-name: no API key for current model", "warning");
			return;
		}

		const promptTemplate = (settings.prompt ?? DEFAULT_PROMPTS[settings.style]).replace(
			"{max}",
			String(settings.maxLength),
		);
		const userPayload = [promptTemplate, "", "<conversation>", conversation.combined, "</conversation>"].join("\n");

		const response = await complete(
			model as Model<never>,
			{
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: userPayload }],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				signal: ctx.signal,
			},
		);

		const title = sanitizeTitle(extractAssistantText(response.content), settings.maxLength);
		if (!title) return;
		if (pi.getSessionName()) return; // user set one manually while we were thinking

		pi.setSessionName(title);
	} catch (err) {
		if (ctx.hasUI) {
			const reason = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`auto-session-name failed: ${reason}`, "warning");
		}
	} finally {
		inflight.delete(guard);
	}
}

function extractAssistantText(content: readonly { type: string; text?: string }[]): string {
	const out: string[] = [];
	for (const part of content) {
		if (part.type === "text" && typeof part.text === "string") out.push(part.text);
	}
	return out.join("\n").trim();
}

function sanitizeTitle(raw: string, maxLength: number): string {
	let title = raw.trim();
	// Drop leading/trailing quotes the model often adds.
	title = title.replace(/^["'`「『《]+|["'`」』》]+$/g, "").trim();
	// Take first non-empty line only.
	title =
		title
			.split(/\r?\n/)
			.find((line) => line.trim().length > 0)
			?.trim() ?? "";
	// Strip trailing punctuation.
	title = title.replace(/[.。，,;；:：!！?？\s]+$/u, "").trim();
	if (!title) return "";
	if ([...title].length <= maxLength) return title;
	const chars = [...title];
	return `${chars.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

function sessionTriedKey(ctx: ExtensionContext): string | undefined {
	const file = ctx.sessionManager.getSessionFile();
	if (file) return `file:${file}`;
	const id = ctx.sessionManager.getSessionId();
	return id ? `id:${id}` : undefined;
}

function loadSettings(): AutoNameSettings {
	const fallback: AutoNameSettings = {
		enabled: true,
		maxLength: DEFAULT_MAX_LENGTH,
		style: DEFAULT_STYLE,
	};

	const configPath = join(homedir(), CONFIG_DIR_NAME, "agent", "@myagent", "auto-session-name", "config.json");

	const merged: AutoNameSettings = { ...fallback };
	try {
		const raw = readFileSync(configPath, "utf-8");
		const s = JSON.parse(raw) as Record<string, unknown>;
		if (typeof s.enabled === "boolean") merged.enabled = s.enabled;
		if (typeof s.maxLength === "number" && Number.isFinite(s.maxLength) && s.maxLength > 0) {
			merged.maxLength = Math.min(120, Math.floor(s.maxLength));
		}
		if (s.style === "concise" || s.style === "descriptive") merged.style = s.style;
		if (typeof s.prompt === "string" && s.prompt.trim()) merged.prompt = s.prompt;
		if (typeof s.model === "string" && s.model.trim()) merged.model = s.model.trim();
	} catch {
		// File missing or unparseable — use defaults.
	}
	return merged;
}
