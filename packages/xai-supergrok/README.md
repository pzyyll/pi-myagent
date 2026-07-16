# xAI SuperGrok OAuth

Registers a dedicated **`xai-supergrok`** provider for SuperGrok / X Premium **subscription OAuth**.

This is intentionally separate from Pi's built-in **`xai`** provider, which stays on the public API-key path (`XAI_API_KEY`).

## Usage

1. Load this extension package through the root `pi.extensions` configuration.
2. In Pi, run `/login xai-supergrok`.
3. Open the xAI verification URL shown by Pi and enter the displayed user code.
4. Choose an `xai-supergrok/...` model from `/model`.

Pi stores the OAuth credentials under the `xai-supergrok` auth key and refreshes the access token through this extension. Requests go to xAI's `cli-chat-proxy` subscription endpoint via Pi's `openai-responses` implementation.

After login (and on token refresh / session start), the extension fetches the account-specific model catalog from `GET https://cli-chat-proxy.grok.com/v1/models` using the same session-auth headers as Grok Build (`Authorization`, `X-XAI-Token-Auth: xai-grok-cli`, client version/identifier). The catalog is cached on the OAuth credential (`modelsCatalog`) so `/model` works offline after the first successful fetch. If the proxy is unreachable and no cache exists, it falls back to `grok-4.5` and `grok-build`.

For API-key / BYOK usage, use the built-in `xai` provider and set `XAI_API_KEY` instead.

## Wire alignment with Grok Build (session OAuth)

Requests use `api: "openai-responses"` against `cli-chat-proxy` and mirror grok-build's session path:

**Body (Responses)**

- Strips `prompt_cache_key` / `prompt_cache_retention` (grok-build leaves both `None`).
- When `reasoning` is present, forces `summary: "concise"` (grok-build default).
- System prompts use `system` role, not `developer` (`supportsDeveloperRole: false`).

**Thinking / effort**

- Models with `supportsReasoningEffort` get a Pi `thinkingLevelMap`:
  - Server `reasoningEfforts` (if present) → only those wire values are selectable.
  - Otherwise the grok-build legacy menu: `low` / `medium` / `high` / `xhigh` (`off` / `minimal` hidden).
- Models without that flag (e.g. fallback `grok-build`) have no effort control — sending effort can 400 on the proxy.
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
- Existing logins without a cached catalog get one on the next session start or token refresh; run `/login xai-supergrok` if the list stays empty.
- If refresh fails, run `/login xai-supergrok` again because xAI refresh tokens may rotate.
- The login flow uses headless device-code OAuth; browser loopback OAuth is not exposed by Pi's current OAuth callback API.
- Not every grok-build sampler header is mirrored (`x-grok-conv-id`, `x-grok-req-id`, `x-grok-agent-id`, turn/deployment ids) — only the product headers needed for session affinity and proxy auth.
