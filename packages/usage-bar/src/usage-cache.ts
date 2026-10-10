// ABOUTME: In-memory per-channel usage cache for instant footer switches.
// ABOUTME: Plans refreshes from successful fetch times using the polling interval.
export const USAGE_POLL_INTERVAL_MS = 2 * 60 * 1_000;

interface UsageCacheEntry<T> {
  readonly value: T;
  readonly fetchedAt: number;
}

export class UsageCache<T> {
  private readonly entries = new Map<string, UsageCacheEntry<T>>();

  planSwitch(channelId: string, now: number): { cached: T | undefined; refresh: boolean } {
    const entry = this.entries.get(channelId);
    return {
      cached: entry?.value,
      refresh: entry === undefined || now - entry.fetchedAt > USAGE_POLL_INTERVAL_MS,
    };
  }

  set(key: string, value: T, fetchedAt: number): void {
    this.entries.set(key, { value, fetchedAt });
  }

  clear(): void {
    this.entries.clear();
  }
}
