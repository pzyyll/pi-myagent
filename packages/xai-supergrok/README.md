# xAI SuperGrok OAuth

Adds OAuth login support for Pi's built-in `xai` provider using xAI's device-code flow. It also overrides Pi's xAI model registration to use the OpenAI Responses API and includes `grok-4.5` when the bundled Pi model list does not yet provide it.

## Usage

1. Load this extension package through the root `pi.extensions` configuration.
2. In Pi, run `/login xai`.
3. Open the xAI verification URL shown by Pi and enter the displayed user code.
4. Choose an `xai/...` model from `/model`.

Pi stores the OAuth credentials and refreshes the access token through this extension. The access token is used as the provider credential for xAI Responses API calls through Pi's `openai-responses` implementation.

If OAuth is not configured or fails, you can still use Pi's built-in API-key path by setting `XAI_API_KEY`.

## Prompt caching

This extension aligns with OpenCode and the official xAI Responses API cache guidance:

- Uses `api: "openai-responses"` for xAI models.
- Explicitly sets body field `prompt_cache_key` to the current Pi session id on every xAI request.
- Clamps the key to 64 characters, matching Pi/OpenAI Responses limits.
- Leaves OpenAI `session_id` header off (`sendSessionIdHeader: false`).
- Leaves `prompt_cache_retention: "24h"` off (`supportsLongCacheRetention: false`) because xAI does not document long retention for this API.

Cache hits remain best-effort. Keep conversation prefixes stable across turns so xAI can reuse cached prompt prefixes.

## Limitations

- Model availability depends on your xAI account and SuperGrok/X Premium entitlements.
- If refresh fails, run `/login xai` again because xAI refresh tokens may rotate.
- The login flow uses opencode's headless device-code OAuth path; browser loopback OAuth is not exposed by Pi's current OAuth callback API.
- Prompt caching is automatic on xAI's side; this extension only sets sticky routing via `prompt_cache_key`.
