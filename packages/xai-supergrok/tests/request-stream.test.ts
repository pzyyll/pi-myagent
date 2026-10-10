// ABOUTME: Tests SuperGrok requests through Pi's real model runtime and Responses adapter.
// ABOUTME: Covers hook-free streams, endpoint isolation, payload callbacks, and cancellation.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Credential, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ModelRuntime, type ExtensionAPI, type ProviderConfig } from "@earendil-works/pi-coding-agent";
import registerSuperGrok, { catalogToModel, FALLBACK_CATALOG, PROVIDER_ID } from "../src/index";

const CLIENT_VERSION = "1.0.46";
const PROXY_URL = "https://cli-chat-proxy.grok.com/v1";
const API_URL = "https://api.x.ai/v1";
const INPUT_TOKENS = 2;
const OUTPUT_TOKENS = 1;
const CONTEXT = { messages: [{ role: "user" as const, content: "Hello", timestamp: 0 }] };

function jwtWithSubject(subject: string): string {
  return `header.${Buffer.from(JSON.stringify({ sub: subject })).toString("base64url")}.signature`;
}

function oauthCredential(subject = "personal-user", userId = "team-principal"): Credential {
  return {
    type: "oauth",
    access: jwtWithSubject(subject),
    refresh: "refresh-token",
    expires: Number.MAX_SAFE_INTEGER,
    userId,
  };
}

function responseStream(): Response {
  const item = {
    type: "message",
    id: "message-1",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "Hello", annotations: [] }],
  };
  const events = [
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    {
      type: "response.content_part.added",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    },
    {
      type: "response.output_text.delta",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: "Hello",
    },
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        id: "response-1",
        status: "completed",
        output: [item],
        usage: {
          input_tokens: INPUT_TOKENS,
          output_tokens: OUTPUT_TOKENS,
          total_tokens: INPUT_TOKENS + OUTPUT_TOKENS,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream", "x-test-response": "observed" },
  });
}

function captureRequests() {
  const requests: Array<{ url: string; headers: Headers; payload: Record<string, unknown> }> = [];
  const fetchImpl = (async (input, init) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, headers: request.headers, payload: JSON.parse(await request.text()) });
    return responseStream();
  }) as typeof fetch;
  return { requests, fetchImpl };
}

function expectProductHeaders(headers: Headers) {
  expect(headers.get("x-grok-client-version")).toBe(CLIENT_VERSION);
  expect(headers.get("x-grok-client-identifier")).toBe("grok-shell");
  expect(headers.get("x-grok-client-mode")).toBe("interactive");
  expect(headers.get("user-agent")).toMatch(/^grok-shell\/1\.0\.46 \(/);
}

describe("provider runtime requests", () => {
  let tempHome: string;
  const environmentKeys = ["PI_CODING_AGENT_DIR", "GROK_HOME", "GROK_OAUTH_USE_API_URL", "XAI_API_KEY"];
  let previousEnvironment: Array<string | undefined>;

  beforeEach(() => {
    previousEnvironment = environmentKeys.map((key) => process.env[key]);
    tempHome = mkdtempSync(join(tmpdir(), "supergrok-runtime-"));
    process.env.PI_CODING_AGENT_DIR = tempHome;
    process.env.GROK_HOME = join(tempHome, "grok");
    delete process.env.GROK_OAUTH_USE_API_URL;
    delete process.env.XAI_API_KEY;
  });

  afterEach(() => {
    environmentKeys.forEach((key, index) => {
      const value = previousEnvironment[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    rmSync(tempHome, { recursive: true, force: true });
  });

  async function createRuntime(credential: Credential = oauthCredential()) {
    const authPath = join(tempHome, "auth.json");
    writeFileSync(authPath, JSON.stringify({ [PROVIDER_ID]: credential }));
    const modelsPath = join(tempHome, "models.json");
    if (credential.type === "api_key") {
      writeFileSync(modelsPath, JSON.stringify({ providers: { [PROVIDER_ID]: { apiKey: "$XAI_API_KEY" } } }));
    }
    const runtime = await ModelRuntime.create({
      authPath,
      modelsPath,
      modelsStorePath: join(tempHome, "models-store.json"),
      refreshOnCreate: false,
    });
    registerSuperGrok({
      registerProvider: (id: string, config: ProviderConfig) => runtime.registerProvider(id, config),
      on: () => {
        throw new Error("Request adaptation must not register session hooks");
      },
    } as unknown as ExtensionAPI);
    await runtime.refresh({ allowNetwork: false });
    return runtime;
  }

  it("sends product/auth headers and an aligned payload without session hooks", async () => {
    const runtime = await createRuntime();
    const { requests, fetchImpl } = captureRequests();
    const model = runtime.getModel(PROVIDER_ID, "grok-4.5")!;
    const result = await runtime.completeSimple(model, CONTEXT, {
      fetch: fetchImpl,
      sessionId: "child-session",
      reasoning: "high",
      headers: { "X-Grok-Client-Version": "outdated", "USER-AGENT": "caller-agent" },
      samplingParams: { prompt_cache_key: "cache-key", prompt_cache_retention: "24h" },
    });
    expect(result.stopReason).toBe("stop");
    expect(result.content).toMatchObject([{ type: "text", text: "Hello" }]);
    expect(result.usage.input).toBe(INPUT_TOKENS);
    expect(result.usage.output).toBe(OUTPUT_TOKENS);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url).toBe(`${PROXY_URL}/responses`);
    expectProductHeaders(request.headers);
    expect(request.headers.get("authorization")).toBe(`Bearer ${jwtWithSubject("personal-user")}`);
    expect(request.headers.get("x-xai-token-auth")).toBe("xai-grok-cli");
    expect(request.headers.get("x-authenticateresponse")).toBe("authenticate-response");
    expect(request.headers.get("x-grok-user-id")).toBe("team-principal");
    expect(request.headers.get("x-grok-session-id")).toBe("child-session");
    expect(request.headers.get("x-grok-conv-id")).toBe("child-session");
    expect(request.headers.get("x-grok-model-override")).toBe(model.id);
    expect(request.headers.get("x-grok-agent-id")).toBeTruthy();
    expect(request.headers.get("x-grok-req-id")).toStartWith("xai-perm-auto-");
    expect(request.headers.has("session_id")).toBe(false);
    expect(request.payload.prompt_cache_key).toBeUndefined();
    expect(request.payload.prompt_cache_retention).toBeUndefined();
    expect(request.payload.reasoning).toEqual({ effort: "high", summary: "concise" });
  });

  it("keeps parallel child sessions and request IDs separate", async () => {
    const runtime = await createRuntime();
    const { requests, fetchImpl } = captureRequests();
    const model = runtime.getModel(PROVIDER_ID, "grok-build")!;
    await Promise.all(
      ["child-a", "child-b"].map((sessionId) =>
        runtime.completeSimple(model, CONTEXT, { fetch: fetchImpl, sessionId, cacheRetention: "none" }),
      ),
    );
    expect(requests.map((request) => request.headers.get("x-grok-session-id")).sort()).toEqual(["child-a", "child-b"]);
    expect(new Set(requests.map((request) => request.headers.get("x-grok-req-id"))).size).toBe(requests.length);
  });

  it("uses JWT identity rather than stored team metadata for an explicit token", async () => {
    const runtime = await createRuntime();
    const { requests, fetchImpl } = captureRequests();
    await runtime.completeSimple(runtime.getModel(PROVIDER_ID, "grok-build")!, CONTEXT, {
      fetch: fetchImpl,
      apiKey: jwtWithSubject("other-user"),
    });
    expect(requests[0]!.headers.get("x-grok-user-id")).toBe("other-user");
    expect(requests[0]!.headers.get("x-grok-session-id")).toBeTruthy();
  });

  it("uses the effective Authorization token when caller headers override credentials", async () => {
    const runtime = await createRuntime();
    const { requests, fetchImpl } = captureRequests();
    await runtime.completeSimple(runtime.getModel(PROVIDER_ID, "grok-build")!, CONTEXT, {
      fetch: fetchImpl,
      headers: { Authorization: `Bearer ${jwtWithSubject("header-user")}` },
    });
    expect(requests[0]!.headers.get("x-grok-user-id")).toBe("header-user");
  });

  for (const baseUrl of [API_URL, "https://custom.example.com/v1", "https://cli-chat-proxy.grok.com.evil.example/v1"]) {
    it(`isolates proxy authentication from ${baseUrl}`, async () => {
      const runtime = await createRuntime({ type: "api_key", key: "public-api-key" });
      const { requests, fetchImpl } = captureRequests();
      const result = await runtime.completeSimple(catalogToModel(FALLBACK_CATALOG[0]!, baseUrl), CONTEXT, {
        fetch: fetchImpl,
        headers: { "X-XAI-Token-Auth": "stale", "X-AuthenticateResponse": "stale", "x-custom": "preserved" },
      });
      expect(result.errorMessage).toBeUndefined();
      expect(result.stopReason).toBe("stop");
      const request = requests[0]!;
      expect(request.url).toBe(`${baseUrl}/responses`);
      expectProductHeaders(request.headers);
      expect(request.headers.get("authorization")).toBe("Bearer public-api-key");
      expect(request.headers.has("x-xai-token-auth")).toBe(false);
      expect(request.headers.has("x-authenticateresponse")).toBe(false);
      expect(request.headers.has("x-grok-user-id")).toBe(false);
      expect(request.headers.get("x-custom")).toBe("preserved");
    });
  }

  it("preserves async instrumentation and re-aligns replacement payloads", async () => {
    const runtime = await createRuntime();
    const { requests, fetchImpl } = captureRequests();
    const model = catalogToModel({ ...FALLBACK_CATALOG[0]!, id: "grok-composer-2.5-fast" });
    const observations: string[] = [];
    const options: SimpleStreamOptions = {
      fetch: fetchImpl,
      reasoning: "high",
      onPayload: async (payload) => {
        observations.push("payload");
        expect((payload as Record<string, unknown>).reasoning).toEqual({ summary: "concise" });
        return {
          ...(payload as object),
          metadata: { caller: "preserved" },
          prompt_cache_key: "replacement-cache",
          reasoning: { effort: "high", summary: "auto" },
        };
      },
      onResponse: async (response) => {
        observations.push("response");
        expect(response.headers["x-test-response"]).toBe("observed");
      },
      onProviderStreamEvent: async () => {
        observations.push("stream-event");
      },
    };
    const result = await runtime.completeSimple(model, CONTEXT, options);
    expect(result.stopReason).toBe("stop");
    expect(observations[0]).toBe("payload");
    expect(observations[1]).toBe("response");
    expect(observations).toContain("stream-event");
    expect(requests[0]!.payload.reasoning).toEqual({ summary: "concise" });
    expect(requests[0]!.payload.prompt_cache_key).toBeUndefined();
    expect(requests[0]!.payload.metadata).toEqual({ caller: "preserved" });
  });

  it("applies the wrapper to the runtime stream entry point too", async () => {
    const runtime = await createRuntime();
    const { requests, fetchImpl } = captureRequests();
    const result = await runtime
      .stream(runtime.getModel(PROVIDER_ID, "grok-build")!, CONTEXT, { fetch: fetchImpl })
      .result();
    expect(result.stopReason).toBe("stop");
    expectProductHeaders(requests[0]!.headers);
    expect(requests[0]!.payload.reasoning).toEqual({ summary: "concise" });
  });

  it("preserves API-specific options on direct runtime streams", async () => {
    const runtime = await createRuntime();
    const { requests, fetchImpl } = captureRequests();
    const result = await runtime
      .stream(runtime.getModel(PROVIDER_ID, "grok-4.5")!, CONTEXT, {
        fetch: fetchImpl,
        reasoningEffort: "xhigh",
        serviceTier: "default",
      })
      .result();
    expect(result.stopReason).toBe("stop");
    expect(requests[0]!.payload.reasoning).toEqual({ effort: "xhigh", summary: "concise" });
    expect(requests[0]!.payload.service_tier).toBe("default");
    expectProductHeaders(requests[0]!.headers);
  });

  it("preserves in-place payload edits when the observer returns undefined", async () => {
    const runtime = await createRuntime();
    const { requests, fetchImpl } = captureRequests();
    const result = await runtime.completeSimple(runtime.getModel(PROVIDER_ID, "grok-build")!, CONTEXT, {
      fetch: fetchImpl,
      headers: { "X-Grok-Session-ID": "header-session", "x-suppressed": null },
      onPayload: async (payload) => {
        (payload as Record<string, unknown>).metadata = { caller: "in-place" };
      },
    });
    expect(result.stopReason).toBe("stop");
    expect(requests[0]!.payload.metadata).toEqual({ caller: "in-place" });
    expect(requests[0]!.headers.get("x-grok-session-id")).toBe("header-session");
    expect(requests[0]!.headers.has("x-suppressed")).toBe(false);
  });

  it("does not adapt another provider's requests", async () => {
    const runtime = await createRuntime();
    runtime.registerProvider("unrelated-provider", {
      api: "openai-responses",
      baseUrl: API_URL,
      apiKey: "unrelated-key",
      models: [{ ...FALLBACK_CATALOG[0]!, reasoning: false }],
    });
    const { requests, fetchImpl } = captureRequests();
    const result = await runtime.completeSimple(runtime.getModel("unrelated-provider", "grok-4.5")!, CONTEXT, {
      fetch: fetchImpl,
      sessionId: "unrelated-session",
    });
    expect(result.stopReason).toBe("stop");
    expect(requests[0]!.headers.has("x-grok-client-version")).toBe(false);
    expect(requests[0]!.headers.has("x-xai-token-auth")).toBe(false);
    expect(requests[0]!.payload.prompt_cache_key).toBe("unrelated-session");
  });

  it("passes cancellation to fetch and returns an aborted terminal message", async () => {
    const runtime = await createRuntime();
    const controller = new AbortController();
    let sawSignal = false;
    const fetchImpl = (async (input, init) => {
      const request = new Request(input, init);
      sawSignal = !request.signal.aborted;
      controller.abort();
      expect(request.signal.aborted).toBe(true);
      throw new DOMException("Request cancelled", "AbortError");
    }) as typeof fetch;
    const result = await runtime.completeSimple(runtime.getModel(PROVIDER_ID, "grok-build")!, CONTEXT, {
      fetch: fetchImpl,
      signal: controller.signal,
      maxRetries: 0,
    });
    expect(sawSignal).toBe(true);
    expect(result.stopReason).toBe("aborted");
  });
});
