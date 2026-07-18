// ABOUTME: Verifies bounded exponential-backoff behavior for transient network failures.
// ABOUTME: Covers recovery, exhausted attempts, and cancellation between attempts.
import { describe, expect, it } from "bun:test";
import { NETWORK_ATTEMPTS, RETRY_BASE_DELAY_MS, retryNetworkRequest } from "./retry";

describe("retryNetworkRequest", () => {
  it("retries with exponential delays and returns a later success", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await retryNetworkRequest(
      async () => {
        attempts++;
        if (attempts < NETWORK_ATTEMPTS) throw new Error("fetch failed");
        return "ok";
      },
      () => true,
      async (milliseconds) => {
        delays.push(milliseconds);
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(delays).toEqual([RETRY_BASE_DELAY_MS, RETRY_BASE_DELAY_MS * 2]);
  });

  it("throws only after all attempts fail", async () => {
    let attempts = 0;
    const finalError = new Error("final failure");

    const request = retryNetworkRequest(
      async () => {
        attempts++;
        throw attempts === NETWORK_ATTEMPTS ? finalError : new Error("fetch failed");
      },
      () => true,
      async () => {},
    );

    await expect(request).rejects.toBe(finalError);
    expect(attempts).toBe(3);
  });

  it("stops when the owning lifecycle becomes inactive", async () => {
    let attempts = 0;
    let active = true;

    const request = retryNetworkRequest(
      async () => {
        attempts++;
        throw new Error("fetch failed");
      },
      () => active,
      async () => {
        active = false;
      },
    );

    await expect(request).rejects.toThrow("fetch failed");
    expect(attempts).toBe(1);
  });
});
