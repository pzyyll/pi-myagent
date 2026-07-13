# @myagent/usage-bar

A minimal Pi extension that shows Codex subscription rate-limit usage as a footer status bar. It appears **only** while an `openai-codex` model is active and uses the standard ChatGPT backend usage endpoint.

## What it shows

```
Codex 5h ███░░░░░ 38% ⟳ 2h  W ██████░░ 75% ⟳ 5d
```

- `5h` — five-hour rolling window (`primary_window`).
- `W` — weekly rolling window (`secondary_window`).
- Bar color: green below 70%, yellow 70–89%, red at 90%+.
- `⟳` shows time until the window resets.

## Behavior

- Active only when the current model's provider is `openai-codex`.
- Fetches `GET https://chatgpt.com/backend-api/wham/usage` on session start and model selection, then polls every 2 minutes.
- Resolves OAuth credentials through Pi's model registry (`getApiKeyAndHeaders`), so Pi handles token refresh.
- Renders whichever windows the API returns:
  - five-hour only
  - weekly only
  - both windows
- Missing, `null`, or non-finite windows are omitted; if no valid window remains, the bar stays hidden.
- Transient network failures and request timeouts are retried up to three total attempts with 2-second and 4-second exponential backoff delays.
- A network warning is shown only after all three attempts fail. The last successful status is kept until the next successful fetch or provider switch.

## Integration

The status is published under the `usage-bars` key, which `@myagent/responsive-footer` already renders as a dedicated footer line. No configuration file is required.
