// ABOUTME: Provides bounded exponential-backoff retries for transient usage endpoint failures.
// ABOUTME: Stops retrying when the owning model or session is no longer active.
export const NETWORK_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 8_000;

type Delay = (milliseconds: number) => Promise<void>;

const delay: Delay = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export async function retryNetworkRequest<T>(
  request: () => Promise<T>,
  shouldContinue: () => boolean,
  wait: Delay = delay,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < NETWORK_ATTEMPTS; attempt++) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (!shouldContinue() || attempt === NETWORK_ATTEMPTS - 1) throw error;
      await wait(RETRY_BASE_DELAY_MS * 2 ** attempt);
      if (!shouldContinue()) throw lastError;
    }
  }

  throw lastError;
}
