// ABOUTME: Exercises usage-bar cache updates through extension lifecycle handlers.
// ABOUTME: Covers immediate switches and late completions after switches or shutdown.
import { afterEach, describe, expect, mock, spyOn, it } from "bun:test";
import usageBar from "../src/index";
import { codexChannel } from "../src/channels/codex";
import { grokChannel } from "../src/channels/grok";
import type { ChannelFetchResult, ChannelUsageView } from "../src/channels";

const cleanups: Array<() => void> = [];
const CODEX_MODEL = { provider: "openai-codex", id: "codex" };
const GROK_MODEL = { provider: "xai-supergrok", id: "grok" };

function result(channelId: string): ChannelFetchResult {
  const view: ChannelUsageView = {
    channelId,
    brand: channelId,
    windows: [{ label: "W", usedPercent: 0 }],
    usable: true,
    renderStatus: () => channelId,
    renderDetails: () => [channelId],
  };
  return { ok: true, view };
}

function harness() {
  const handlers = new Map<string, (event: any, ctx: any) => void>();
  let command: (args: string, ctx: any) => Promise<void>;
  let status: string | undefined;
  const notifications: string[] = [];
  const ctx = {
    model: CODEX_MODEL,
    hasUI: true,
    mode: "json",
    modelRegistry: {
      isUsingOAuth: () => true,
      getAvailable: () => [CODEX_MODEL, GROK_MODEL],
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-token" }),
    },
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus: (_key: string, value: string | undefined) => {
        status = value;
      },
      notify: (message: string) => {
        notifications.push(message);
      },
      select: async () => "Codex",
    },
  };
  usageBar({
    on: (name: string, handler: (event: any, ctx: any) => void) => handlers.set(name, handler),
    registerCommand: (_name: string, config: any) => {
      command = config.handler;
    },
  } as any);
  const emit = (name: string, event = {}) => handlers.get(name)!(event, ctx);
  cleanups.push(() => emit("session_shutdown"));
  return {
    emit,
    select: (model: typeof CODEX_MODEL) => {
      ctx.model = model;
      emit("model_select", { model });
    },
    usages: () => command("", ctx),
    status: () => status,
    notifications,
  };
}

function completeAtBoundary(value: ChannelFetchResult, boundary: () => void): Promise<ChannelFetchResult> {
  // Run between fetchChannelUsage's generation check and its caller's continuation.
  queueMicrotask(() => queueMicrotask(boundary));
  return Promise.resolve(value);
}

const flush = () => Bun.sleep(0);

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  mock.restore();
});

describe("usage-bar lifecycle", () => {
  it("fetches on a miss and immediately restores each channel's fresh cache", async () => {
    const codex = spyOn(codexChannel, "fetch").mockResolvedValue(result(codexChannel.id));
    const grok = spyOn(grokChannel, "fetch").mockResolvedValue(result(grokChannel.id));
    const h = harness();
    h.emit("session_start");
    await flush();
    h.select(GROK_MODEL);
    await flush();
    expect(h.status()).toBe(grokChannel.id);
    h.select(CODEX_MODEL);
    expect(h.status()).toBe(codexChannel.id);
    h.select(GROK_MODEL);
    expect(h.status()).toBe(grokChannel.id);
    expect(codex).toHaveBeenCalledTimes(1);
    expect(grok).toHaveBeenCalledTimes(1);
  });

  it("does not publish or cache a completion after switching models", async () => {
    const h = harness();
    const codex = spyOn(codexChannel, "fetch")
      .mockImplementationOnce(() => completeAtBoundary(result(codexChannel.id), () => h.select(GROK_MODEL)))
      .mockResolvedValue(result(codexChannel.id));
    spyOn(grokChannel, "fetch").mockImplementation(() => new Promise(() => {}));
    h.emit("session_start");
    await flush();
    expect(h.status()).toBeUndefined();
    h.select(CODEX_MODEL);
    await flush();
    expect(codex).toHaveBeenCalledTimes(2);
  });

  it("does not refill a cleared cache after shutdown", async () => {
    const h = harness();
    const codex = spyOn(codexChannel, "fetch")
      .mockImplementationOnce(() => completeAtBoundary(result(codexChannel.id), () => h.emit("session_shutdown")))
      .mockResolvedValue(result(codexChannel.id));
    h.emit("session_start");
    await flush();
    expect(h.status()).toBeUndefined();
    h.emit("session_start");
    await flush();
    expect(codex).toHaveBeenCalledTimes(2);
  });

  it("discards a /usages completion after shutdown", async () => {
    const h = harness();
    const codex = spyOn(codexChannel, "fetch")
      .mockImplementationOnce(() => completeAtBoundary(result(codexChannel.id), () => h.emit("session_shutdown")))
      .mockResolvedValue(result(codexChannel.id));
    await h.usages();
    expect(h.notifications).toEqual([]);
    h.emit("session_start");
    await flush();
    expect(codex).toHaveBeenCalledTimes(2);
  });

  it("fills the footer cache from a successful /usages query", async () => {
    const codex = spyOn(codexChannel, "fetch").mockResolvedValue(result(codexChannel.id));
    const h = harness();
    await h.usages();
    h.emit("session_start");
    expect(h.status()).toBe(codexChannel.id);
    expect(codex).toHaveBeenCalledTimes(1);
  });
});
