# SuperGrok OAuth Implementation Plan

**Goal:** Add a Pi extension package that lets Pi authenticate the built-in `xai` provider through xAI Grok/SuperGrok OAuth and use the existing Grok model list without requiring an API key.

**Inputs:** User request to migrate opencode's SuperGrok OAuth flow into a Pi extension; opencode `packages/opencode/src/plugin/xai.ts`; Pi extension docs for `pi.registerProvider()` OAuth support; current `pi-myagent` monorepo structure.

**Assumptions:**

- Implement the device-code OAuth flow first because it works in TUI, SSH, VPS, and headless contexts without a local callback server.
- Reuse Pi's built-in `xai` provider and model list instead of replacing models or switching APIs in this first implementation.
- Use xAI's public Grok-CLI OAuth client ID and scopes exactly as opencode does.
- Pi's existing OAuth storage handles persisted credentials and locked refresh; the extension only provides login, refresh, and `getApiKey` functions.

**Architecture:** Create a new workspace package `packages/xai-supergrok` that registers OAuth metadata for provider `xai` via `pi.registerProvider("xai", { oauth })`. The extension implements xAI RFC 8628 device authorization, token polling with RFC backoff behavior, and refresh-token exchange. Pi's model registry will continue to use the built-in `xai` models and will call the OAuth provider's `getApiKey()` to send the access token as the provider credential.

**Tech Stack:** TypeScript, Pi extension API, `@earendil-works/pi-ai/compat` OAuth types, built-in `fetch`, Bun workspace scripts.

---

## File Map

- Create: `packages/xai-supergrok/package.json` — Declares the Pi extension package and peer dependencies.
- Create: `packages/xai-supergrok/README.md` — Documents usage, `/login xai`, and limitations.
- Create: `packages/xai-supergrok/src/index.ts` — Registers the `xai` OAuth provider and implements device-code login and refresh.
- Modify: `package.json` — Adds `packages/xai-supergrok` to the root `pi.extensions` list so Pi loads it from the monorepo package.

## Tasks

### Task 1: Add the extension package skeleton

**Outcome:** The monorepo has a loadable Pi extension package for xAI SuperGrok OAuth.

**Files:**

- Create: `packages/xai-supergrok/package.json`
- Create: `packages/xai-supergrok/README.md`
- Create: `packages/xai-supergrok/src/index.ts`
- Modify: `package.json`

**Steps:**

- [ ] Create `packages/xai-supergrok/package.json` matching existing package conventions: private `@myagent/xai-supergrok`, `pi-package` and `pi-extension` keywords, `files` containing `src` and `README.md`, peer dependencies on `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`, and `pi.extensions` pointing at `./src/index.ts`.
- [ ] Add `packages/xai-supergrok` to the root `package.json` `pi.extensions` array.
- [ ] Create `packages/xai-supergrok/src/index.ts` with the required two-line `ABOUTME` header and an exported default extension function.
- [ ] Create `packages/xai-supergrok/README.md` explaining that the package adds `/login xai` OAuth support for SuperGrok subscription tokens while reusing Pi's built-in xAI models.

**Validation:**

- Run: `bun run typecheck`
- Expected: TypeScript sees the new package source without type errors.

### Task 2: Implement xAI device-code login

**Outcome:** `/login xai` can start xAI device authorization, show the verification URL and user code through Pi's OAuth callbacks, poll until the user authorizes, and persist OAuth credentials through Pi.

**Files:**

- Modify: `packages/xai-supergrok/src/index.ts`

**Steps:**

- [ ] Define xAI OAuth constants from opencode: `CLIENT_ID`, `TOKEN_URL`, `DEVICE_AUTHORIZATION_URL`, `DEVICE_CODE_GRANT_TYPE`, and `SCOPE`.
- [ ] Define response interfaces for xAI token and device-code responses with exact fields used by the implementation.
- [ ] Implement `authHeaders()` returning `Content-Type: application/x-www-form-urlencoded` and `Accept: application/json`.
- [ ] Implement `requestDeviceCode()` as a POST to `https://auth.x.ai/oauth2/device/code` with form body `client_id` and `scope`.
- [ ] Validate that the device-code response contains `device_code`, `user_code`, and `verification_uri`; throw a useful error if fields are missing.
- [ ] Implement `positiveSecondsToMs()` to normalize invalid `interval` and `expires_in` values to safe defaults.
- [ ] Implement `pollDeviceCodeToken()` with the same terminal and retry behavior as opencode: continue on `authorization_pending`, add five seconds on `slow_down`, throw on `access_denied`/`authorization_denied`, throw on `expired_token`, and stop at the computed deadline.
- [ ] Implement `loginXai(callbacks)` that calls `requestDeviceCode()`, invokes `callbacks.onDeviceCode({ userCode, verificationUri, intervalSeconds, expiresInSeconds })`, polls for tokens, and returns `{ refresh, access, expires }` with a 120-second expiry skew.

**Validation:**

- Run: `bun run typecheck`
- Expected: No TypeScript errors in the new OAuth flow.

### Task 3: Implement refresh and provider registration

**Outcome:** Pi can refresh xAI OAuth credentials and use the current access token as the provider credential for Grok model requests.

**Files:**

- Modify: `packages/xai-supergrok/src/index.ts`
- Modify: `packages/xai-supergrok/README.md`

**Steps:**

- [ ] Implement `refreshAccessToken(refreshToken)` as a POST to `https://auth.x.ai/oauth2/token` with form body `grant_type=refresh_token`, `refresh_token`, and `client_id`.
- [ ] Implement `refreshXaiToken(credentials)` that returns the new access token, the rotated refresh token when provided, and an expiry timestamp skewed by 120 seconds.
- [ ] Register provider `xai` with only an `oauth` config: `name: "xAI Grok OAuth (SuperGrok)"`, `login: loginXai`, `refreshToken: refreshXaiToken`, and `getApiKey: (credentials) => credentials.access`.
- [ ] Keep the provider registration model-free so built-in xAI models remain intact.
- [ ] Update the README with exact usage: load the extension, run `/login xai`, choose an `xai/...` model from `/model`, and optionally use `XAI_API_KEY` as a fallback if OAuth is not configured.

**Validation:**

- Run: `bun run typecheck`
- Expected: The provider registration type-checks and does not require defining models.

### Task 4: Run project checks and inspect behavior boundaries

**Outcome:** The implementation follows project formatting, linting, and documented usage requirements.

**Files:**

- Modify: Any files changed by formatting.

**Steps:**

- [ ] Run `bun run lint` and fix actionable lint errors in the new package.
- [ ] Run `bun run format` to apply repository formatting.
- [ ] Run `bun run check` after formatting.
- [ ] Inspect `git diff -- packages/xai-supergrok package.json docs/plans/2026-07-09-supergrok-oauth-plan.md` to ensure scope is limited to the new extension, root extension registration, and this plan.

**Validation:**

- Run: `bun run check`
- Expected: Type-check, lint, and format check all pass.

## Final Validation

- Run: `bun run check`
- Expected: All repository checks pass.
- Manual check after loading in Pi: run `/login xai`, confirm Pi displays the xAI device verification URL and user code, authorize in browser, then select an `xai/...` model and send a short prompt.
- Expected manual result: Pi sends the request using the OAuth access token returned by xAI; if the token is expired on a later run, Pi calls the extension's `refreshToken()` and persists the refreshed credentials.

## Rollout Notes

- This extension changes auth behavior for the existing provider id `xai`; it does not add a new provider id.
- Users with `XAI_API_KEY` can still use the built-in API-key path because the extension only adds OAuth registration.
- Users should re-run `/login xai` if refresh fails because xAI refresh tokens may rotate and old tokens can become invalid.
- Browser loopback OAuth is intentionally out of scope for this first implementation; the device-code flow is the supported login path.
- Switching xAI from Pi's built-in `openai-completions` implementation to `openai-responses` is out of scope for this implementation and should be a separate change after confirming xAI accepts Pi's Responses payload.

## Risks and Mitigations

- xAI may restrict the public Grok-CLI OAuth client ID — Keep the constants isolated in `src/index.ts` so replacing the client registration is a small change.
- The SuperGrok subscription token may not authorize every model in Pi's built-in xAI model list — Surface the upstream API error and document that model availability depends on the user's xAI subscription entitlements.
- Device-code polling can hammer the token endpoint if xAI returns invalid interval values — Normalize invalid values and honor `slow_down` with a five-second increment.
- Refresh-token rotation can make stale credentials fail — Return rotated refresh tokens when present and rely on Pi's locked OAuth refresh storage to avoid cross-process races.
