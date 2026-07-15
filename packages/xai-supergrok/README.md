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

## Prompt caching

This extension aligns with OpenCode and the official xAI Responses API cache guidance:

- Uses `api: "openai-responses"` for SuperGrok models.
- Explicitly sets body field `prompt_cache_key` to the current Pi session id on every request.
- Clamps the key to 64 characters, matching Pi/OpenAI Responses limits.
- Leaves OpenAI `session_id` header off (`sendSessionIdHeader: false`).
- Leaves `prompt_cache_retention: "24h"` off (`supportsLongCacheRetention: false`) because xAI does not document long retention for this API.

Cache hits remain best-effort. Keep conversation prefixes stable across turns so xAI can reuse cached prompt prefixes.

## Limitations

- Model availability is whatever cli-chat-proxy returns for your SuperGrok/X Premium entitlements (not a static list in this package).
- Existing logins without a cached catalog get one on the next session start or token refresh; run `/login xai-supergrok` if the list stays empty.
- If refresh fails, run `/login xai-supergrok` again because xAI refresh tokens may rotate.
- The login flow uses headless device-code OAuth; browser loopback OAuth is not exposed by Pi's current OAuth callback API.
- Prompt caching is automatic on xAI's side; this extension only sets sticky routing via `prompt_cache_key`.
