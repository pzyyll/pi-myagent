# xAI SuperGrok OAuth

Registers a dedicated **`xai-supergrok`** provider for SuperGrok / X Premium **subscription OAuth** over **cli-chat-proxy** (Grok Build session path).

This is intentionally separate from Pi's built-in **`xai`** provider:

|                 | Built-in `xai`                                      | This package `xai-supergrok`                          |
| --------------- | --------------------------------------------------- | ----------------------------------------------------- |
| Auth            | `XAI_API_KEY` and/or Pi device-code OAuth (0.80.8+) | SuperGrok session OAuth (+ optional `~/.grok` import) |
| Endpoint        | `https://api.x.ai/v1`                               | `https://cli-chat-proxy.grok.com/v1`                  |
| Models          | Static built-in catalog                             | Dynamic entitlements via `/v1/models`                 |
| Product headers | None                                                | grok-shell / cli-chat-proxy attribution               |

Requires **Pi ≥ 0.80.8** (`refreshModels`, `readStoredCredential`).

## Usage

1. Load this extension package through the root `pi.extensions` configuration.
2. In Pi run `/login xai-supergrok`.
3. If `~/.grok/auth.json` already has a Grok Build session, choose:
   - **Import from ~/.grok/auth.json** — one-shot copy into Pi auth (does not keep syncing afterward)
   - **OAuth device login** — start a fresh xAI device-code session
4. If there is no Grok session, device-code OAuth starts directly.
5. Choose an `xai-supergrok/...` model from `/model`.

### Auth ownership (`~/.pi/agent/auth.json`)

Pi **owns** SuperGrok credentials under the `xai-supergrok` OAuth key in
`~/.pi/agent/auth.json` (so Pi's refresh lock works).

- **No auto-import** on session start.
- **Optional import** only when you explicitly pick it during `/login xai-supergrok`.
- **Never writes** `~/.grok/auth.json` — login/refresh update Pi auth only.
- Token refresh uses the same OIDC refresh endpoint as grok-build (including optional
  `principal_type` / `principal_id`), but rotations stay in Pi's auth file.

`~/.grok/auth.json` remains Grok Build's own store in the native scope format
`https://auth.x.ai::<client_id>` with `key` / `refresh_token` / `expires_at` / profile fields.
Import is a snapshot copy, not a live link.

### Models catalog (`~/.pi/agent/grok_models_cache.json`)

Pi 0.80.8 drives discovery through provider **`refreshModels`** (register offline pass, `/model` background refresh, `pi update --models`). When network is allowed and SuperGrok OAuth is present, the extension fetches `GET https://cli-chat-proxy.grok.com/v1/models` with the same session-auth headers as Grok Build (`Authorization`, `X-XAI-Token-Auth: xai-grok-cli`, client version/identifier). Login and token refresh also warm the cache.

The catalog is saved **only** as **`~/.pi/agent/grok_models_cache.json`** (Pi agent dir; override with `PI_CODING_AGENT_DIR`). It is **not** stored on OAuth credentials in `~/.pi/agent/auth.json` — that file stays token-only. Grok Build keeps its own `~/.grok/models_cache.json` (warm-start when the Pi cache is missing). Shape matches that cache (`fetched_at`, `auth_method`, `origin`, `etag`, `models` map). If the proxy is unreachable and no cache exists, it falls back to `grok-4.5` and `grok-build`.

For public API-key / BYOK (or Pi's built-in xAI subscription against `api.x.ai`), use the built-in `xai` provider instead.

## Wire alignment with Grok Build (session OAuth)

Requests use `api: "openai-responses"` against `cli-chat-proxy` and mirror grok-build's session path:

**Body (Responses)**

- Strips `prompt_cache_key` / `prompt_cache_retention` (grok-build leaves both `None`).
- When `reasoning` is present, forces `summary: "concise"` (grok-build default).
- System prompts use `system` role, not `developer` (`supportsDeveloperRole: false`).

**Thinking / effort**

- CCP `supportsReasoningEffort` means _selectable effort_, not “emits reasoning”.
- Models with `supportsReasoningEffort` get a Pi `thinkingLevelMap`:
  - Server `reasoningEfforts` (if present) → only those wire values are selectable.
  - Otherwise the grok-build legacy menu: `low` / `medium` / `high` / `xhigh` (`off` / `minimal` hidden).
- Always-on reasoning models (e.g. `grok-composer-2.5-fast`) advertise `supportsReasoningEffort: false` but still reason; they are marked `reasoning: true` with a fixed map (no effort picker). Wire `effort` is stripped — only `summary: "concise"` is sent (same as grok-build CreateResponse when effort is unset).
- Models without effort or always-on treatment (e.g. fallback `grok-build`) have `reasoning: false` — sending effort can 400 on the proxy.
- Every Responses body gets `reasoning.summary = "concise"` even when effort is unset (grok-build CreateResponse shape).

**Headers**

- Product: `x-grok-client-version`, `x-grok-client-identifier`, `x-grok-session-id`, `x-grok-model-override`, and `x-grok-user-id` (JWT `sub` when available).
- cli-chat-proxy auth attribution: `X-XAI-Token-Auth: xai-grok-cli`, `x-authenticateresponse`, `x-grok-client-mode`.
- OpenAI `session_id` header is off (`sessionAffinityFormat: "openai-nosession"`). Sticky routing is via `x-grok-session-id`, not body cache keys.

Prefix cache hits remain best-effort on the proxy/backend side; keep conversation prefixes stable across turns.

## Usage cost display

cli-chat-proxy model catalog has no unit prices. For Pi footer estimates this package fills `model.cost` from a prefab table:

- Official Text API short-context rates (`docs.x.ai/developers/pricing`): e.g. `grok-4.5` $2 / $6 / cache $0.50, `grok-build` → `grok-build-0.1` $1 / $2 / cache $0.20.
- Grok Build–only models missing from that table: e.g. `grok-composer-2.5-fast` $0.50 / $2.50 / cache $0.20 (product announcement / models.dev).

Unknown ids stay $0. This is list-price estimation only — SuperGrok subscription billing is not the same as metered API.

## Limitations

- Model availability is whatever cli-chat-proxy returns for your SuperGrok/X Premium entitlements (not a static list in this package).
- Existing logins without a cached catalog get one on the next `/model` refresh, `pi update --models`, or token refresh; run `/login xai-supergrok` if the list stays empty.
- If refresh fails, run `/login xai-supergrok` (or re-import / re-OAuth) again because xAI refresh tokens may rotate.
- Importing from `~/.grok/auth.json` copies tokens into Pi at that moment only. Later Grok Build rotations are **not** auto-adopted; re-run `/login` and choose import again if needed.
- The login flow uses headless device-code OAuth; browser loopback OAuth is not exposed by Pi's current OAuth callback API.
- Not every grok-build sampler header is mirrored (`x-grok-conv-id`, `x-grok-req-id`, `x-grok-agent-id`, turn/deployment ids) — only the product headers needed for session affinity and proxy auth.
