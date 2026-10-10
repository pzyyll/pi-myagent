// ABOUTME: Tests SuperGrok OAuth scopes and provider-level request registration.
// ABOUTME: Checks fixed product headers without main-session event hooks.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import registerSuperGrok, { applyGrokBuildProductHeaders } from "../src/index";

function registerProvider() {
  let config: ProviderConfig | undefined;
  const events: string[] = [];
  registerSuperGrok({
    registerProvider: (_name: string, value: ProviderConfig) => {
      config = value;
    },
    on: (name: string) => {
      events.push(name);
    },
  } as unknown as ExtensionAPI);
  if (!config) throw new Error("Provider registration is incomplete");
  return { config, events };
}

function jwtWithSubject(subject: string): string {
  return `header.${Buffer.from(JSON.stringify({ sub: subject })).toString("base64url")}.signature`;
}

const NODE_LOADER_TIMEOUT_MS = 30_000;
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

  it("registers fixed headers and streaming without main-session hooks", () => {
    const { config, events } = registerProvider();
    expect(config.headers?.["x-grok-client-version"]).toBe("1.0.46");
    expect(config.headers?.["x-grok-client-identifier"]).toBe("grok-shell");
    expect(config.headers?.["x-grok-client-mode"]).toBe("interactive");
    expect(config.headers?.["User-Agent"]).toMatch(/^grok-shell\/1\.0\.46 \(/);
    expect(config.streamSimple).toBeFunction();
    expect(events).toEqual([]);
  });

  it(
    "loads through Pi's Node extension loader",
    () => {
      const script = `
        const { loadExtensions } = await import(new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
        const result = await loadExtensions([process.argv[1]], process.cwd());
        console.log(JSON.stringify({ extensions: result.extensions.length, errors: result.errors }));
        if (result.errors.length) process.exitCode = 1;
      `;
      const child = spawnSync(
        "node",
        ["--input-type=module", "-e", script, fileURLToPath(new URL("../src/index.ts", import.meta.url))],
        {
          cwd: fileURLToPath(new URL("../../../", import.meta.url)),
          encoding: "utf8",
          timeout: NODE_LOADER_TIMEOUT_MS,
        },
      );
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({ extensions: 1, errors: [] });
    },
    NODE_LOADER_TIMEOUT_MS,
  );

  it("falls back to JWT sub when the stored userId is empty", () => {
    const headers: Record<string, string | null> = {};
    applyGrokBuildProductHeaders(headers, { userId: "", accessToken: jwtWithSubject("personal-user") });
    expect(headers["x-grok-user-id"]).toBe("personal-user");
  });
});
