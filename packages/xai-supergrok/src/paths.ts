// ABOUTME: Resolves GROK_HOME and Pi agent paths for SuperGrok auth import / model caches.
// ABOUTME: Auth is Pi-owned (~/.pi/agent/auth.json); ~/.grok/auth.json is optional read-only import.
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";

export const OIDC_ISSUER = "https://auth.x.ai";
export const OIDC_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const GROK_AUTH_FILE = "auth.json";
/** Pi-owned catalog cache under ~/.pi/agent (grok-build uses ~/.grok/models_cache.json). */
export const GROK_MODELS_CACHE_FILE = "grok_models_cache.json";
/** Read-only warm-start from an existing Grok Build catalog. */
export const GROK_BUILD_MODELS_CACHE_FILE = "models_cache.json";

export function grokHome(): string {
	return process.env.GROK_HOME || join(homedir(), ".grok");
}

/** Pi agent config dir (e.g. ~/.pi/agent), honors PI_CODING_AGENT_DIR. */
export function piAgentDir(): string {
	return getAgentDir();
}

export function grokAuthPath(): string {
	return join(grokHome(), GROK_AUTH_FILE);
}

/** `~/.pi/agent/grok_models_cache.json` — Pi-owned ModelsCatalog cache. */
export function grokModelsCachePath(): string {
	return join(piAgentDir(), GROK_MODELS_CACHE_FILE);
}

export function grokBuildModelsCachePath(): string {
	return join(grokHome(), GROK_BUILD_MODELS_CACHE_FILE);
}

/** auth.json scope key: `{issuer}::{client_id}` (grok-build GrokComConfig::auth_scope). */
export function authScopeKey(issuer: string = OIDC_ISSUER, clientId: string = OIDC_CLIENT_ID): string {
	return `${issuer.replace(/\/+$/, "")}::${clientId}`;
}
