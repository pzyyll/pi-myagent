// ABOUTME: Tests SuperGrok OAuth scopes and registered request-header behavior.
// ABOUTME: Covers stored identity precedence and proxy-only authentication boundaries.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type {
  BeforeProviderHeadersEvent,
  ExtensionAPI,
  ExtensionContext,
  ProviderConfig,
} from "@earendil-works/pi-coding-agent";
import registerSuperGrok, { applyGrokBuildProductHeaders, PROVIDER_ID } from "../src/index";

function registerProvider() {
  let config: ProviderConfig | undefined;
  let headersHandler: ((event: BeforeProviderHeadersEvent, ctx: ExtensionContext) => void) | undefined;
  registerSuperGrok({
    registerProvider: (_name: string, value: ProviderConfig) => {
      config = value;
    },
    on: (name: string, handler: typeof headersHandler) => {
      if (name === "before_provider_headers") headersHandler = handler;
    },
  } as unknown as ExtensionAPI);
  if (!config || !headersHandler) throw new Error("Provider registration is incomplete");
  return { config, headersHandler };
}

function jwtWithSubject(subject: string): string {
  return `header.${Buffer.from(JSON.stringify({ sub: subject })).toString("base64url")}.signature`;
}

const PERSONAL_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "grok-cli:access",
  "api:access",
  "conversations:read",
  "conversations:write",
  "workspaces:read",
  "workspaces:write",
];

describe("request authentication", () => {
  let tempHome: string;
  let previousAgentDir: string | undefined;
  let previousGrokHome: string | undefined;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    previousGrokHome = process.env.GROK_HOME;
    tempHome = mkdtempSync(join(tmpdir(), "supergrok-request-auth-"));
    process.env.PI_CODING_AGENT_DIR = tempHome;
    process.env.GROK_HOME = join(tempHome, "grok");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousGrokHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = previousGrokHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("requests all current personal OAuth scopes", async () => {
    let body: URLSearchParams | undefined;
    const stop = new Error("Stop after device-code request");
    globalThis.fetch = (async (_url, init) => {
      body = new URLSearchParams(String(init?.body));
      throw stop;
    }) as typeof fetch;
    const { config } = registerProvider();
    await expect(config.oauth!.login({} as OAuthLoginCallbacks)).rejects.toThrow(stop.message);
    expect(body?.get("scope")?.split(" ")).toEqual(PERSONAL_SCOPES);
    expect(body?.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828");
    expect(body?.get("referrer")).toBe("grok-build");
  });

  it("prefers the stored team identity over access-token sub in the registered hook", () => {
    writeFileSync(
      join(tempHome, "auth.json"),
      JSON.stringify({
        [PROVIDER_ID]: {
          type: "oauth",
          access: jwtWithSubject("personal-user"),
          refresh: "refresh-token",
          expires: Number.MAX_SAFE_INTEGER,
          userId: "team-principal",
        },
      }),
    );
    const { headersHandler } = registerProvider();
    const event: BeforeProviderHeadersEvent = { type: "before_provider_headers", headers: {} };
    headersHandler(event, {
      model: { provider: PROVIDER_ID, id: "grok-build", baseUrl: "https://cli-chat-proxy.grok.com/v1" },
      sessionManager: { getSessionId: () => "session-id" },
    } as unknown as ExtensionContext);
    expect(event.headers["x-grok-user-id"]).toBe("team-principal");
    expect(event.headers["X-XAI-Token-Auth"]).toBe("xai-grok-cli");
    expect(event.headers["x-authenticateresponse"]).toBe("authenticate-response");
  });

  it("falls back to JWT sub when the stored userId is empty", () => {
    const headers: Record<string, string | null> = {};
    applyGrokBuildProductHeaders(headers, { userId: "", accessToken: jwtWithSubject("personal-user") });
    expect(headers["x-grok-user-id"]).toBe("personal-user");
  });

  it("sends client mode to API endpoints without proxy authentication headers", () => {
    const { headersHandler } = registerProvider();
    const event: BeforeProviderHeadersEvent = { type: "before_provider_headers", headers: {} };
    headersHandler(event, {
      model: { provider: PROVIDER_ID, id: "grok-build", baseUrl: "https://api.x.ai/v1" },
      sessionManager: { getSessionId: () => "session-id" },
    } as unknown as ExtensionContext);
    expect(event.headers["x-grok-client-mode"]).toBe("interactive");
    expect(event.headers["X-XAI-Token-Auth"]).toBeUndefined();
    expect(event.headers["x-authenticateresponse"]).toBeUndefined();
    expect(event.headers["x-grok-user-id"]).toBeUndefined();
  });

  it("does not change headers for other providers", () => {
    const { headersHandler } = registerProvider();
    const event: BeforeProviderHeadersEvent = { type: "before_provider_headers", headers: {} };
    headersHandler(event, { model: { provider: "xai" } } as unknown as ExtensionContext);
    expect(event.headers).toEqual({});
  });
});
