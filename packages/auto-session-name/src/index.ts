// ABOUTME: Auto-generates a session title from the first user/assistant exchange.
// ABOUTME: Applies it via setSessionName, with optional model and fallbackModels.
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
  fallbackModels: string[];
}

const DEFAULT_PROMPTS: Record<NamingStyle, string> = {
  concise:
    "Generate a short title (max {max} characters) summarizing the user's intent in this conversation. " +
    "Use the same language as the user. Return ONLY the title, no quotes, no punctuation at the end, no explanation.",
  descriptive:
    "Generate a descriptive title (max {max} characters) capturing the topic and outcome of this conversation. " +
    "Use the same language as the user. Return ONLY the title, no quotes, no trailing punctuation, no explanation.",
};

let namingInflight = false;
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

interface ModelCandidate {
  /** Display label for notifications (provider/modelId or "active"). */
  label: string;
  model: Model<any>;
}

/** Parse `provider/modelId`; returns undefined if the ref is malformed. */
function parseModelRef(ref: string): { provider: string; modelId: string } | undefined {
  const slashIdx = ref.indexOf("/");
  if (slashIdx <= 0 || slashIdx >= ref.length - 1) return undefined;
  return { provider: ref.slice(0, slashIdx), modelId: ref.slice(slashIdx + 1) };
}

function lookupModel(ctx: ExtensionContext, ref: string): Model<any> | undefined {
  const parsed = parseModelRef(ref);
  if (!parsed) return undefined;
  return ctx.modelRegistry.find(parsed.provider, parsed.modelId);
}

/**
 * Build the ordered model attempt list:
 * 1. configured `model` if set and found; else active session model when `model` is unset
 * 2. each `fallbackModels` entry that resolves
 * 3. active session model as last resort when a configured primary was missing (legacy behaviour)
 */
function collectModelCandidates(
  ctx: ExtensionContext,
  settings: AutoNameSettings,
): { candidates: ModelCandidate[]; unresolved: string[] } {
  const candidates: ModelCandidate[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  const push = (label: string, model: Model<any> | undefined) => {
    if (!model) return;
    const key = `${model.provider}/${model.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ label, model });
  };

  if (settings.model) {
    const found = lookupModel(ctx, settings.model);
    if (found) {
      push(settings.model, found);
    } else {
      unresolved.push(settings.model);
    }
  } else {
    push("active", ctx.model);
  }

  for (const ref of settings.fallbackModels) {
    const found = lookupModel(ctx, ref);
    if (found) {
      push(ref, found);
    } else {
      unresolved.push(ref);
    }
  }

  // Prefer configured primary was missing and nothing else resolved → use active (old UX).
  if (settings.model && candidates.length === 0) {
    push("active", ctx.model);
  }

  return { candidates, unresolved };
}

async function runNaming(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  settings: AutoNameSettings,
  conversation: Conversation,
): Promise<void> {
  if (namingInflight) return;
  namingInflight = true;

  try {
    const { candidates, unresolved } = collectModelCandidates(ctx, settings);
    if (candidates.length === 0) {
      if (ctx.hasUI) {
        const detail = unresolved.length > 0 ? ` (not found: ${unresolved.join(", ")})` : "";
        ctx.ui.notify(`auto-session-name: no active model${detail}`, "warning");
      }
      return;
    }

    const promptTemplate = (settings.prompt ?? DEFAULT_PROMPTS[settings.style]).replace(
      "{max}",
      String(settings.maxLength),
    );
    const userPayload = [promptTemplate, "", "<conversation>", conversation.combined, "</conversation>"].join("\n");

    const failures: string[] = [];
    for (const ref of unresolved) {
      failures.push(`${ref}: not found`);
    }

    for (const { label, model } of candidates) {
      if (ctx.signal?.aborted) return;

      try {
        const title = await nameWithModel(ctx, model, userPayload, settings.maxLength);
        if (!title) {
          failures.push(`${label}: empty title`);
          continue;
        }
        if (pi.getSessionName()) return; // user set one manually while we were thinking
        pi.setSessionName(title);
        return;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failures.push(`${label}: ${reason}`);
      }
    }

    if (ctx.hasUI && failures.length > 0) {
      ctx.ui.notify(`auto-session-name failed: ${failures.join("; ")}`, "warning");
    }
  } finally {
    namingInflight = false;
  }
}

async function nameWithModel(
  ctx: ExtensionContext,
  model: Model<any>,
  userPayload: string,
  maxLength: number,
): Promise<string> {
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    throw new Error("no API key");
  }

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

  if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(response.errorMessage?.trim() || response.stopReason);
  }

  return sanitizeTitle(extractAssistantText(response.content), maxLength);
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
    fallbackModels: [],
  };

  const configPath = join(homedir(), CONFIG_DIR_NAME, "agent", "@myagent", "auto-session-name", "config.json");

  const merged: AutoNameSettings = { ...fallback, fallbackModels: [] };
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
    if (Array.isArray(s.fallbackModels)) {
      const refs: string[] = [];
      const seen = new Set<string>();
      for (const item of s.fallbackModels) {
        if (typeof item !== "string") continue;
        const ref = item.trim();
        if (!ref || seen.has(ref)) continue;
        seen.add(ref);
        refs.push(ref);
      }
      merged.fallbackModels = refs;
    }
  } catch {
    // File missing or unparseable — use defaults.
  }
  return merged;
}
