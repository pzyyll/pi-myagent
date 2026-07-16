// ABOUTME: Tests ~/.grok/auth.json read-only import and Pi-owned credential construction.
// ABOUTME: Covers grok-build GrokAuth format import without writing the real home directory.
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildGrokAuthEntry,
	credentialsFromTokens,
	describeGrokAuthSession,
	EARLY_INVALIDATION_MS,
	grokAuthToCredentials,
	importCredentialsFromGrokAuth,
	isGrokAuthExpired,
} from "./grok-auth";
import { authScopeKey } from "./paths";

function tempAuthPath(): { dir: string; path: string } {
	const dir = mkdtempSync(join(tmpdir(), "xai-supergrok-auth-"));
	return { dir, path: join(dir, "auth.json") };
}

const dirs: string[] = [];

afterEach(() => {
	while (dirs.length) {
		const dir = dirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("grok auth.json bridge", () => {
	it("imports OIDC session entry from grok-build auth.json format", () => {
		const { dir, path } = tempAuthPath();
		dirs.push(dir);
		const scope = authScopeKey();
		const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
		writeFileSync(
			path,
			JSON.stringify({
				[scope]: {
					key: "access-token-from-grok",
					auth_mode: "oidc",
					create_time: new Date().toISOString(),
					user_id: "user-1",
					email: "u@example.com",
					principal_type: "User",
					principal_id: "user-1",
					refresh_token: "refresh-from-grok",
					expires_at: expiresAt,
					oidc_issuer: "https://auth.x.ai",
					oidc_client_id: "b1a00492-073a-47ea-816f-4c329264a828",
				},
			}),
		);

		const creds = importCredentialsFromGrokAuth(path);
		expect(creds?.access).toBe("access-token-from-grok");
		expect(creds?.refresh).toBe("refresh-from-grok");
		expect(creds?.userId).toBe("user-1");
		expect(creds?.email).toBe("u@example.com");
		// expires is hard expiry minus early invalidation
		expect(creds?.expires).toBeLessThanOrEqual(Date.parse(expiresAt) - EARLY_INVALIDATION_MS + 5);
		expect(creds?.expires).toBeGreaterThan(Date.now());
		expect(describeGrokAuthSession(creds!)).toBe("u@example.com");
	});

	it("marks auth expired inside the early-invalidation window", () => {
		const entry = buildGrokAuthEntry({
			accessToken: "a",
			refreshToken: "r",
			expiresInSeconds: 60, // 1 minute < 5 minute buffer
		});
		expect(isGrokAuthExpired(entry)).toBe(true);
	});

	it("credentialsFromTokens builds Pi credentials without needing disk", () => {
		const creds = credentialsFromTokens(
			{
				accessToken: "new-access",
				refreshToken: "new-refresh",
				expiresInSeconds: 3600,
			},
			{ kind: "login" },
		);

		expect(creds.access).toBe("new-access");
		expect(creds.refresh).toBe("new-refresh");
		expect(creds.expires).toBeGreaterThan(Date.now());
		expect(creds.oidcIssuer).toBe("https://auth.x.ai");
		expect(creds.oidcClientId).toBe("b1a00492-073a-47ea-816f-4c329264a828");
	});

	it("credentialsFromTokens refresh preserves createTime and profile fields", () => {
		const createTime = "2026-01-01T00:00:00.000Z";
		const previous = {
			access: "old-access",
			refresh: "old-refresh",
			expires: Date.now() + 1000,
			userId: "user-1",
			email: "u@example.com",
			principalType: "User",
			principalId: "user-1",
			teamId: "team-1",
			oidcIssuer: "https://auth.x.ai",
			oidcClientId: "b1a00492-073a-47ea-816f-4c329264a828",
			createTime,
		};

		const creds = credentialsFromTokens(
			{
				accessToken: "rotated-access",
				refreshToken: "rotated-refresh",
				expiresInSeconds: 7200,
			},
			{ kind: "refresh", previousCredentials: previous },
		);

		expect(creds.access).toBe("rotated-access");
		expect(creds.refresh).toBe("rotated-refresh");
		expect(creds.createTime).toBe(createTime);
		expect(creds.email).toBe("u@example.com");
		expect(creds.userId).toBe("user-1");
		expect(creds.principalType).toBe("User");
		expect(creds.teamId).toBe("team-1");
	});

	it("returns undefined when grok auth has no refresh token", () => {
		const { dir, path } = tempAuthPath();
		dirs.push(dir);
		const scope = authScopeKey();
		writeFileSync(
			path,
			JSON.stringify({
				[scope]: {
					key: "access-only",
					auth_mode: "oidc",
					create_time: new Date().toISOString(),
					user_id: "u",
					oidc_issuer: "https://auth.x.ai",
					oidc_client_id: "b1a00492-073a-47ea-816f-4c329264a828",
				},
			}),
		);

		expect(importCredentialsFromGrokAuth(path)).toBeUndefined();
	});

	it("grokAuthToCredentials maps access/refresh/expires", () => {
		const entry = buildGrokAuthEntry({
			accessToken: "at",
			refreshToken: "rt",
			expiresInSeconds: 3600,
		});
		const creds = grokAuthToCredentials(entry);
		expect(creds.access).toBe("at");
		expect(creds.refresh).toBe("rt");
		expect(creds.expires).toBeGreaterThan(Date.now());
	});
});
