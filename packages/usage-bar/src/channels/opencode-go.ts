// ABOUTME: OpenCode Go subscription usage channel via /zen/go/v1/usage.
// ABOUTME: Uses the same API key as model requests (Bearer auth), not OAuth.
import {
  parseOpenCodeGoPlanUsage,
  renderOpenCodeGoPlanUsageDetails,
  renderOpenCodeGoUsage,
  type OpenCodeGoPlanUsage,
} from "../opencode-go-usage";
import { retryNetworkRequest } from "../retry";
import type { ChannelFetchArgs, ChannelFetchResult, ChannelUsageView, UsageChannel } from "./types";

const PROVIDER_ID = "opencode-go";
const ENDPOINT = "https://opencode.ai/zen/go/v1/usage";
const FETCH_TIMEOUT_MS = 12_000;

export const opencodeGoChannel: UsageChannel = {
  id: PROVIDER_ID,
  brand: "OpenCode Go",
  providers: [PROVIDER_ID],
  requiresOAuth: false,
  matches(provider: string) {
    return provider === PROVIDER_ID;
  },
  async fetch(args: ChannelFetchArgs): Promise<ChannelFetchResult> {
    const apiKey = bearerToken(args.auth);
    if (!apiKey) {
      return { ok: false, error: "usage-bar: missing OpenCode Go API key" };
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...args.auth.headers,
      Authorization: `Bearer ${apiKey}`,
    };

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
      const usage = parseOpenCodeGoPlanUsage(result.json, args.now);
      if (!usage.usable) {
        return { ok: false, error: "usage-bar: unrecognized OpenCode Go usage payload" };
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

function toView(usage: OpenCodeGoPlanUsage): ChannelUsageView {
  return {
    channelId: PROVIDER_ID,
    brand: "Go",
    windows: usage.windows,
    usable: usage.usable,
    renderDetails: (fg) => renderOpenCodeGoPlanUsageDetails(usage, fg),
    renderStatus: (fg) => renderOpenCodeGoUsage(usage, fg),
  };
}

function bearerToken(auth: ChannelFetchArgs["auth"]): string | undefined {
  const header = findHeader(auth.headers, "authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1].trim();
  }
  return auth.apiKey?.trim() || undefined;
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function nestedAbort(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener("abort", onParentAbort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeoutId);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}
