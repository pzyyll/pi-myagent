# Codex Usage Bar Implementation Plan

**Goal:** Add a minimal Pi extension that displays Codex subscription rate-limit usage only while an `openai-codex` model is active.

**Inputs:** User requirements for `packages/usage-bar`; Pi extension and TUI documentation; the existing `responsive-footer` status integration; current Codex `GET /backend-api/wham/usage` response models and mapping code; the installed `pi-usage-bars` implementation as behavioral reference.

**Assumptions:**

- For the ChatGPT backend base URL, use `GET https://chatgpt.com/backend-api/wham/usage`; current Codex source selects this path for `ChatGptApi`, and a live OAuth-authenticated probe returns 200 while `/backend-api/api/codex/usage` returns 403.
- Pi remains the source of OAuth truth: the extension resolves credentials through `ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)` instead of reading or writing `auth.json` directly.
- The status uses the existing `usage-bars` key so `packages/responsive-footer` renders it as a dedicated footer line.
- Poll every two minutes while Codex is active, fetch immediately on session start or model selection, and keep the last successful value during a transient refresh failure.
- Credits, spend controls, additional rate limits, commands, configuration, and non-Codex providers are out of scope for this minimal version.

**Architecture:** Split the package into a small pure module for response parsing and text rendering and an extension entry point for Pi lifecycle, authentication, polling, cancellation, and status updates. Treat `primary_window` and `secondary_window` independently, derive each label from `limit_window_seconds`, and render whichever valid windows are present without assuming both exist.

**Tech Stack:** TypeScript, Pi extension API, built-in `fetch` and `AbortController`, Bun workspace and `bun:test`.

---

## File Map

- Create: `packages/usage-bar/package.json` — Declares the Pi extension package and its package-level test script.
- Create: `packages/usage-bar/README.md` — Documents activation, display format, polling behavior, and supported response cases.
- Create: `packages/usage-bar/src/usage.ts` — Defines the validated Codex usage model, response parser, reset formatting, percentage colors, and compact bar renderer.
- Create: `packages/usage-bar/src/usage.test.ts` — Covers five-hour-only, weekly-only, both-window, malformed, clamped-percentage, and reset-time behavior.
- Create: `packages/usage-bar/src/index.ts` — Registers Pi lifecycle handlers, resolves OAuth credentials, fetches the standard Codex usage endpoint, and manages status visibility and polling.
- Modify: `package.json` — Adds `packages/usage-bar` to the root `pi.extensions` list.
- Modify: `bun.lock` — Records the new workspace package without adding runtime dependencies.

## Behavioral Design

### Visibility and lifecycle

- The extension is active only when `ctx.model?.provider === "openai-codex"`.
- On `session_start`, inspect the current model. If it is Codex, fetch immediately and start one polling timer; otherwise clear `usage-bars` and remain idle.
- On `model_select`, switching to Codex fetches immediately and starts polling. Switching away aborts any request, stops polling, discards stale in-flight results, and clears `usage-bars` immediately.
- On `session_shutdown`, stop the timer, abort the request, and clear the status.
- A request generation counter prevents a response started for an old model/session from restoring the bar after the user has switched providers.

### Authentication and request

- Resolve the active model’s auth with `ctx.modelRegistry.getApiKeyAndHeaders(model)` so Pi handles OAuth refresh and provider-specific headers.
- Send `GET https://chatgpt.com/backend-api/wham/usage` with the resolved headers, adding `Authorization: Bearer <apiKey>` only when Pi returns an API key and did not already provide an authorization header.
- Use `Accept: application/json`, a 12-second timeout, and an `AbortController`.
- Never log or persist access tokens or response headers.

### Response parsing

The parser accepts unknown JSON and reads only:

```text
rate_limit.primary_window.used_percent
rate_limit.primary_window.limit_window_seconds
rate_limit.primary_window.reset_after_seconds
rate_limit.primary_window.reset_at
rate_limit.secondary_window.used_percent
rate_limit.secondary_window.limit_window_seconds
rate_limit.secondary_window.reset_after_seconds
rate_limit.secondary_window.reset_at
```

For each window independently:

- Missing or `null` window: omit it.
- Non-finite `used_percent`: omit that window.
- Valid percentage: clamp to `0..100` for display.
- Reset time: prefer valid Unix `reset_at`; otherwise derive it from non-negative `reset_after_seconds`; omit reset text if neither is valid.
- Label: use `5h` for a five-hour duration, `W` for a seven-day duration, and a compact duration label for other positive values. If duration is absent or invalid, fall back to `5h` for `primary_window` and `W` for `secondary_window`.
- If neither window is valid, treat the payload as unusable rather than displaying a misleading `0%`.

Required combinations:

1. Five-hour only: render one `5h` segment.
2. Weekly only: render one `W` segment, even when the primary window is absent.
3. Both: render `5h` then `W`, preserving API primary/secondary order when labels do not identify those standard durations.

### Rendering and failure behavior

- Status format: `Codex 5h ███░░░░░ 38% ⟳ 2h  W ██████░░ 75% ⟳ 5d`.
- Each bar is eight cells wide, with rounded and clamped percentages.
- `<70%` uses the theme success color, `70–89%` warning, and `>=90%` error; labels and reset text use dim styling.
- An initial auth, HTTP, timeout, or parse failure leaves the status hidden.
- A refresh failure preserves the last successful status until a later successful refresh or provider switch.
- Poll requests do not overlap; if one is already running, the next timer tick is skipped.

## Tasks

### Task 1: Add the package skeleton and pure usage model

**Outcome:** The workspace contains a loadable `@myagent/usage-bar` package with isolated parsing and rendering logic.

**Files:**

- Create: `packages/usage-bar/package.json`
- Create: `packages/usage-bar/README.md`
- Create: `packages/usage-bar/src/usage.ts`
- Modify: `package.json`
- Modify: `bun.lock`

**Steps:**

- [ ] Create the package manifest following existing `@myagent/*` conventions, with `pi.extensions` pointing to `./src/index.ts`, a peer dependency on `@earendil-works/pi-coding-agent`, and `test: "bun test"`.
- [ ] Add `packages/usage-bar` to the root `pi.extensions` array without changing unrelated dependency versions or extension entries.
- [ ] Add the required two-line `ABOUTME` header to every new TypeScript file.
- [ ] Implement narrow runtime guards for records and finite numeric fields; do not cast the whole API response to a trusted interface.
- [ ] Implement independent primary/secondary parsing, duration-based labels, percentage clamping, reset deadline selection, and a renderer that accepts Pi’s theme foreground function.
- [ ] Document that the extension supports only Codex subscription windows and appears only for the `openai-codex` provider.
- [ ] Refresh the Bun lockfile only as needed to register the new workspace package.

**Validation:**

- Run: `bun run typecheck`
- Expected: The new pure module and package manifest introduce no TypeScript errors.

### Task 2: Add boundary-focused tests

**Outcome:** The required one-window and two-window cases, plus malformed responses, are executable and deterministic.

**Files:**

- Create: `packages/usage-bar/src/usage.test.ts`

**Steps:**

- [ ] Test a payload with only `primary_window` and a five-hour duration; expect one `5h` segment with its percentage and reset text.
- [ ] Test a payload with only `secondary_window` and a seven-day duration; expect one `W` segment and no fabricated five-hour segment.
- [ ] Test a payload containing both windows; expect both segments in primary/secondary order.
- [ ] Test a weekly-duration window supplied as the only primary window; expect duration-based `W` labeling rather than a positional `5h` label.
- [ ] Test missing, `null`, and non-finite window values; expect unusable input when no valid window remains.
- [ ] Test percentages below zero and above 100; expect display clamping to `0%` and `100%`.
- [ ] Test reset handling with fixed `now`: `reset_at` wins over `reset_after_seconds`, the relative fallback works, and past reset times render as due now rather than a negative duration.

**Validation:**

- Run: `bun test packages/usage-bar/src/usage.test.ts`
- Expected: All usage parsing and rendering cases pass without network access.

### Task 3: Implement Codex-only polling and status lifecycle

**Outcome:** The bar appears and refreshes only for active `openai-codex` models and cannot leak across provider or session changes.

**Files:**

- Create: `packages/usage-bar/src/index.ts`

**Steps:**

- [ ] Define constants for provider id `openai-codex`, status key `usage-bars`, endpoint `https://chatgpt.com/backend-api/wham/usage`, two-minute polling, and 12-second timeout.
- [ ] Implement auth resolution through `ctx.modelRegistry.getApiKeyAndHeaders(model)` and merge headers case-insensitively without overwriting an existing authorization header.
- [ ] Implement one abortable GET request that checks `response.ok`, parses JSON as unknown, and delegates validation to `parseCodexUsage`.
- [ ] Implement an idempotent deactivate path that stops polling, aborts the current request, advances the generation counter, clears cached display state, and calls `ctx.ui.setStatus("usage-bars", undefined)`.
- [ ] Implement activation that fetches immediately, starts exactly one interval, skips overlapping polls, and updates the themed status only if the provider/session generation is still current.
- [ ] Register `session_start`, `model_select`, and `session_shutdown` handlers with no timers created during extension factory execution.
- [ ] Preserve the last successful status on refresh errors while hiding initial failures; do not emit repeated notifications for background polling failures.

**Validation:**

- Run: `bun run typecheck`
- Expected: Lifecycle handlers, model auth resolution, fetch, and status rendering type-check against the installed Pi API.

### Task 4: Format, run all checks, and inspect scope

**Outcome:** The package passes focused and repository-wide validation with no unrelated edits introduced by this work.

**Files:**

- Modify: Any new usage-bar files changed by formatting.

**Steps:**

- [ ] Run Prettier on `packages/usage-bar`, `package.json`, and the plan document.
- [ ] Run the focused Bun test suite.
- [ ] Run the repository `bun run check` command.
- [ ] Inspect `git diff -- packages/usage-bar package.json bun.lock docs/plans/2026-07-13-codex-usage-bar-plan.md` and confirm the implementation does not alter existing package behavior or dependency versions.
- [ ] Confirm all new TypeScript files begin with exactly two `ABOUTME` comment lines.

**Validation:**

- Run: `bun test packages/usage-bar/src/usage.test.ts && bun run check`
- Expected: Focused tests, type checking, linting, and formatting checks all pass.

## Final Validation

- Run: `bun test packages/usage-bar/src/usage.test.ts`
- Expected: The five-hour-only, weekly-only, both-window, malformed-response, clamping, and reset tests all pass.
- Run: `bun run check`
- Expected: TypeScript, ESLint, and Prettier checks all pass.
- Manual smoke test: load the package, select an `openai-codex` model, and confirm a usage line appears after the request completes; switch to a different provider and confirm the line disappears immediately.

## Rollout Notes

- The package is loaded through the root `pi.extensions` list and uses the status key already handled specially by `packages/responsive-footer`.
- The usage endpoint is an authenticated ChatGPT backend endpoint. API shape changes should fail closed by retaining the last valid display rather than reporting false `0%` values.
- No migration or configuration file is required.

## Risks and Mitigations

- The direct backend endpoint may change — Isolate the endpoint and parser, validate unknown JSON, and avoid coupling lifecycle code to the response shape.
- OAuth credentials may expire — Resolve auth through Pi’s model registry on each poll so Pi can refresh credentials using its standard provider flow.
- A late request may restore the bar after switching models — Abort on deactivation and guard every result with a generation token and current-provider check.
- One limit may be absent or appear in an unexpected slot — Parse windows independently and derive standard labels from their durations before using positional fallbacks.
- Repeated polling may overlap or continue after shutdown — Keep one interval, skip while a request is in flight, and centralize timer/request cleanup.
