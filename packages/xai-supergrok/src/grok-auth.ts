// ABOUTME: Read-only bridge from ~/.grok/auth.json into Pi SuperGrok OAuth credentials.
// ABOUTME: Builds Pi-owned tokens for login/refresh without writing back to Grok Build.

import { readFileSync } from "node:fs";
import type { OAuthCredentials } from "@earendil-works/pi-ai";
import { isRecord, peekJwtUserId } from "./catalog";
import { authScopeKey, grokAuthPath, OIDC_CLIENT_ID, OIDC_ISSUER } from "./paths";

/** Match grok-build early_invalidation (5 minutes) so Pi refreshes with the same margin. */
export const EARLY_INVALIDATION_MS = 300_000;
/** Fallback TTL when expires_at is missing (grok-build TOKEN_TTL = 30 days). */
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type GrokAuthMode = "web_login" | "oidc" | "external" | "api_key";

/** Subset of grok-build `GrokAuth` needed for session OAuth + refresh. */
export interface GrokAuthEntry {
	key: string;
	auth_mode: GrokAuthMode | string;
	create_time?: string;
	user_id?: string;
	email?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	profile_image_asset_id?: string | null;
	principal_type?: string | null;
	principal_id?: string | null;
	team_id?: string | null;
	team_name?: string | null;
	team_role?: string | null;
	organization_id?: string | null;
	organization_name?: string | null;
	organization_role?: string | null;
	coding_data_retention_opt_out?: boolean;
	refresh_token?: string | null;
	expires_at?: string | null;
	oidc_issuer?: string | null;
	oidc_client_id?: string | null;
	[key: string]: unknown;
}

export type GrokAuthStore = Record<string, GrokAuthEntry>;

/** Pi OAuth credentials plus metadata needed to refresh SuperGrok session tokens. */
export type SuperGrokCredentials = OAuthCredentials & {
	userId?: string;
	email?: string;
	principalType?: string;
	principalId?: string;
	teamId?: string;
	oidcIssuer?: string;
	oidcClientId?: string;
	/** ISO create_time carried from an optional Grok import. */
	createTime?: string;
};

export function isGrokAuthEntry(value: unknown): value is GrokAuthEntry {
	if (!isRecord(value)) return false;
	return typeof value.key === "string" && value.key.length > 0;
}

export function readGrokAuthStore(path: string = grokAuthPath()): GrokAuthStore {
	try {
		const raw = readFileSync(path, "utf8").trim();
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return {};
		const store: GrokAuthStore = {};
		for (const [scope, entry] of Object.entries(parsed)) {
			if (isGrokAuthEntry(entry)) store[scope] = entry;
		}
		return store;
	} catch {
		return {};
	}
}

function isSessionAuthMode(mode: string | undefined): boolean {
	// grok-build AuthMode::is_session_auth — Oidc / legacy WebLogin only.
	const m = (mode ?? "oidc").toLowerCase();
	return m === "oidc" || m === "web_login" || m === "grok";
}

/**
 * Prefer the active xAI OIDC scope, else first entry with refresh_token + oidc_issuer.
 * Skips legacy WebLogin-only entries when a proper OIDC entry exists.
 */
export function findSessionAuth(
	store: GrokAuthStore = readGrokAuthStore(),
	preferredScope: string = authScopeKey(),
): { scope: string; entry: GrokAuthEntry } | undefined {
	const preferred = store[preferredScope];
	if (preferred && preferred.refresh_token && isSessionAuthMode(String(preferred.auth_mode))) {
		return { scope: preferredScope, entry: preferred };
	}

	for (const [scope, entry] of Object.entries(store)) {
		if (!entry.refresh_token || !entry.oidc_issuer) continue;
		if (!isSessionAuthMode(String(entry.auth_mode))) continue;
		// Skip pure WebLogin if we can (server path is high-volume fragile).
		if (String(entry.auth_mode).toLowerCase() === "web_login") continue;
		return { scope, entry };
	}

	// Last resort: preferred scope even without refresh (read-only use).
	if (preferred?.key) return { scope: preferredScope, entry: preferred };
	return undefined;
}

function parseIsoMs(value: string | null | undefined): number | undefined {
	if (!value) return undefined;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : undefined;
}

/** grok-build is_expired_with_buffer — true when within early-invalidation of expiry. */
export function isGrokAuthExpired(entry: GrokAuthEntry, nowMs: number = Date.now()): boolean {
	const expiresMs = parseIsoMs(entry.expires_at ?? undefined);
	if (expiresMs !== undefined) {
		return nowMs >= expiresMs - EARLY_INVALIDATION_MS;
	}
	const createdMs = parseIsoMs(entry.create_time) ?? nowMs;
	return nowMs >= createdMs + TOKEN_TTL_MS - EARLY_INVALIDATION_MS;
}

export function grokAuthToCredentials(entry: GrokAuthEntry): SuperGrokCredentials {
	const expiresMs = parseIsoMs(entry.expires_at ?? undefined);
	const createdMs = parseIsoMs(entry.create_time) ?? Date.now();
	const hardExpiry = expiresMs ?? createdMs + TOKEN_TTL_MS;
	const expires = Math.max(Date.now(), hardExpiry - EARLY_INVALIDATION_MS);

	const userId = (typeof entry.user_id === "string" && entry.user_id) || peekJwtUserId(entry.key) || undefined;

	return {
		access: entry.key,
		refresh: entry.refresh_token ?? "",
		expires,
		...(userId ? { userId } : {}),
		...(entry.email ? { email: entry.email } : {}),
		...(entry.principal_type ? { principalType: entry.principal_type } : {}),
		...(entry.principal_id ? { principalId: entry.principal_id } : {}),
		...(entry.team_id ? { teamId: entry.team_id } : {}),
		...(entry.oidc_issuer ? { oidcIssuer: entry.oidc_issuer } : {}),
		...(entry.oidc_client_id ? { oidcClientId: entry.oidc_client_id } : {}),
		...(entry.create_time ? { createTime: entry.create_time } : {}),
	};
}

/** Import usable SuperGrok credentials from ~/.grok/auth.json when present (read-only). */
export function importCredentialsFromGrokAuth(path: string = grokAuthPath()): SuperGrokCredentials | undefined {
	const found = findSessionAuth(readGrokAuthStore(path));
	if (!found?.entry.refresh_token) return undefined;
	return grokAuthToCredentials(found.entry);
}

/** Human-readable identity for the /login import option. */
export function describeGrokAuthSession(credentials: SuperGrokCredentials): string {
	return credentials.email || credentials.userId || "existing session";
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	if (parts.length < 2 || !parts[1]) return undefined;
	try {
		const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/") + "===".slice((parts[1].length + 3) % 4);
		const payload: unknown = JSON.parse(globalThis.atob(padded));
		return isRecord(payload) ? payload : undefined;
	} catch {
		return undefined;
	}
}

function firstString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

/** Build a GrokAuth entry from OIDC token response fields + optional previous profile. */
export function buildGrokAuthEntry(input: {
	accessToken: string;
	refreshToken: string;
	expiresInSeconds?: number;
	issuer?: string;
	clientId?: string;
	previous?: GrokAuthEntry;
	now?: Date;
}): GrokAuthEntry {
	const now = input.now ?? new Date();
	const claims = decodeJwtPayload(input.accessToken) ?? {};
	const prev = input.previous;

	const principalType = firstString(claims, "principal_type", "principalType") ?? prev?.principal_type ?? undefined;
	const principalId = firstString(claims, "principal_id", "principalId") ?? prev?.principal_id ?? undefined;
	const teamId = firstString(claims, "team_id", "teamId") ?? prev?.team_id ?? undefined;
	const userId =
		(principalType === "Team" && principalId ? principalId : undefined) ??
		firstString(claims, "sub", "user_id", "userId") ??
		prev?.user_id ??
		"";
	const email = firstString(claims, "email") ?? prev?.email ?? undefined;

	const expiresAt =
		input.expiresInSeconds && input.expiresInSeconds > 0
			? new Date(now.getTime() + input.expiresInSeconds * 1000).toISOString()
			: (prev?.expires_at ?? undefined);

	return {
		key: input.accessToken,
		auth_mode: "oidc",
		create_time: prev?.create_time ?? now.toISOString(),
		user_id: userId,
		email: email ?? null,
		first_name: prev?.first_name ?? null,
		last_name: prev?.last_name ?? null,
		profile_image_asset_id: prev?.profile_image_asset_id ?? null,
		principal_type: principalType ?? null,
		principal_id: principalId ?? null,
		team_id: teamId ?? null,
		team_name: prev?.team_name ?? null,
		team_role: prev?.team_role ?? null,
		organization_id: prev?.organization_id ?? null,
		organization_name: prev?.organization_name ?? null,
		organization_role: prev?.organization_role ?? null,
		coding_data_retention_opt_out: prev?.coding_data_retention_opt_out ?? false,
		refresh_token: input.refreshToken,
		expires_at: expiresAt ?? null,
		oidc_issuer: input.issuer ?? prev?.oidc_issuer ?? OIDC_ISSUER,
		oidc_client_id: input.clientId ?? prev?.oidc_client_id ?? OIDC_CLIENT_ID,
	};
}

/**
 * Build Pi-owned SuperGrok credentials from OIDC tokens.
 * Never writes ~/.grok/auth.json — Pi persists only under ~/.pi/agent/auth.json.
 */
export function credentialsFromTokens(
	tokens: {
		accessToken: string;
		refreshToken: string;
		expiresInSeconds?: number;
	},
	opts?: {
		previousCredentials?: SuperGrokCredentials;
		kind?: "login" | "refresh";
		now?: Date;
	},
): SuperGrokCredentials {
	const kind = opts?.kind ?? "login";
	const previous =
		kind === "refresh" && opts?.previousCredentials
			? {
					key: opts.previousCredentials.access,
					auth_mode: "oidc",
					refresh_token: opts.previousCredentials.refresh,
					user_id: opts.previousCredentials.userId,
					email: opts.previousCredentials.email,
					principal_type: opts.previousCredentials.principalType,
					principal_id: opts.previousCredentials.principalId,
					team_id: opts.previousCredentials.teamId,
					oidc_issuer: opts.previousCredentials.oidcIssuer ?? OIDC_ISSUER,
					oidc_client_id: opts.previousCredentials.oidcClientId ?? OIDC_CLIENT_ID,
					create_time: opts.previousCredentials.createTime,
				}
			: undefined;

	const entry = buildGrokAuthEntry({
		accessToken: tokens.accessToken,
		refreshToken: tokens.refreshToken,
		expiresInSeconds: tokens.expiresInSeconds,
		issuer: previous?.oidc_issuer ?? OIDC_ISSUER,
		clientId: previous?.oidc_client_id ?? OIDC_CLIENT_ID,
		previous: kind === "refresh" ? previous : undefined,
		now: opts?.now,
	});

	return grokAuthToCredentials(entry);
}
