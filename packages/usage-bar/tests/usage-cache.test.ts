// ABOUTME: Tests per-channel usage cache decisions for footer model switches.
// ABOUTME: Covers instant cache hits, immediate misses, staleness, and channel isolation.
import { describe, expect, it } from "bun:test";
import { USAGE_POLL_INTERVAL_MS, UsageCache } from "../src/usage-cache";

const NOW = 1_700_000_000_000;

describe("UsageCache.planSwitch", () => {
  it("requests immediately when the selected channel has no cache", () => {
    const cache = new UsageCache<string>();
    cache.set("openai-codex", "codex", NOW);

    const plan = cache.planSwitch("xai-supergrok", NOW + 1_000);

    expect(plan.cached).toBeUndefined();
    expect(plan.refresh).toBe(true);
  });

  it("shows a fresh channel cache without requesting again", () => {
    const cache = new UsageCache<string>();
    cache.set("openai-codex", "codex", NOW);
    cache.set("xai-supergrok", "grok", NOW + 1_000);

    const plan = cache.planSwitch("openai-codex", NOW + 2_000);

    expect(plan.cached).toBe("codex");
    expect(plan.refresh).toBe(false);
  });

  it("shows a stale cache and requests a refresh immediately", () => {
    const cache = new UsageCache<string>();
    cache.set("xai-supergrok", "grok", NOW);

    const plan = cache.planSwitch("xai-supergrok", NOW + USAGE_POLL_INTERVAL_MS + 1);

    expect(plan.cached).toBe("grok");
    expect(plan.refresh).toBe(true);
  });

  it("treats another channel's recent fetch as irrelevant", () => {
    const cache = new UsageCache<string>();
    cache.set("openai-codex", "codex", NOW);

    const back = cache.planSwitch("openai-codex", NOW + 500);
    const across = cache.planSwitch("opencode-go", NOW + 500);

    expect(back).toEqual({ cached: "codex", refresh: false });
    expect(across).toEqual({ cached: undefined, refresh: true });
  });

  it("drops every channel on clear", () => {
    const cache = new UsageCache<string>();
    cache.set("xai-supergrok", "grok", NOW);

    cache.clear();

    expect(cache.planSwitch("xai-supergrok", NOW)).toEqual({
      cached: undefined,
      refresh: true,
    });
  });
});
