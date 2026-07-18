// ABOUTME: Codex usage channel — ChatGPT wham/usage endpoint and plan parsing.
// ABOUTME: Resolves chatgpt-account-id from JWT claims when the registry omits it.
import { retryNetworkRequest } from "../retry";
import { parseCodexPlanUsage, renderCodexPlanUsageDetails, renderCodexUsage, type CodexPlanUsage } from "../usage";
import type { ChannelFetchArgs, ChannelFetchResult, ChannelUsageView, UsageChannel } from "./types";

const PROVIDER_ID = "openai-codex";
const ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const FETCH_TIMEOUT_MS = 12_000;

export const codexChannel: UsageChannel = {
  id: "openai-codex",
  brand: "Codex",
  providers: [PROVIDER_ID],
  matches(provider: string) {
    return provider === PROVIDER_ID;
  },
  async fetch(args: ChannelFetchArgs): Promise<ChannelFetchResult> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "codex-cli",
      originator: "pi",
      ...args.auth.headers,
    };
    if (!hasHeader(headers, "authorization") && args.auth.apiKey) {
      headers["Authorization"] = `Bearer ${args.auth.apiKey}`;
    }
    const accountId = extractAccountId(args.auth.apiKey);
    if (accountId && !hasHeader(headers, "chatgpt-account-id")) {
      headers["chatgpt-account-id"] = accountId;
    }

    try {
      const result = await retryNetworkRequest(async () => {
        const controller = nestedAbort(args.signal, FETCH_TIMEOUT_MS);
        try {
          const response = await (args.fetchImpl ?? fetch)(ENDPOINT, {
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
      const usage = parseCodexPlanUsage(result.json, args.now);
      if (!usage.usable) {
        return { ok: false, error: "usage-bar: unrecognized Codex usage payload" };
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

function toView(usage: CodexPlanUsage): ChannelUsageView {
  return {
    channelId: PROVIDER_ID,
    brand: "Codex",
    windows: usage.windows,
    usable: usage.usable,
    renderDetails: (fg) => renderCodexPlanUsageDetails(usage, fg),
    renderStatus: (fg) => renderCodexUsage({ windows: usage.windows, usable: usage.windows.length > 0 }, fg),
  };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function extractAccountId(token: string | undefined): string | undefined {
  if (!token) return undefined;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(atob(parts[1]!)) as Record<string, unknown>;
    const claim = payload[JWT_CLAIM_PATH];
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) return undefined;
    const accountId = (claim as Record<string, unknown>)["chatgpt_account_id"];
    return typeof accountId === "string" ? accountId : undefined;
  } catch {
    return undefined;
  }
}

function nestedAbort(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener("abort", onParentAbort, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeoutId);
      parent.removeEventListener("abort", onParentAbort);
      if (timedOut && !parent.aborted) {
        // surface timeout as a normal error via the aborted request
      }
    },
  };
}
