# @myagent/usage-bar

A Pi extension that shows subscription usage as a footer status bar and detailed `/usages` panel. It supports multiple channels behind one pipeline:

| Channel | Provider id | Source |
| ------- | ----------- | ------ |
| **Codex** | `openai-codex` | `GET https://chatgpt.com/backend-api/wham/usage` |
| **Grok** | `xai-supergrok` | `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` |

The footer appears only while a matching model is active. `/usages` can query any configured channel even when another model is selected.

## What it shows

### Codex

```
Codex 5h ███░░░░░ 38% ⟳ 2h  W ██████░░ 75% ⟳ 5d
```

- `5h` — five-hour rolling window (`primary_window`).
- `W` — weekly rolling window (`secondary_window`).

### Grok (SuperGrok OAuth)

```
Grok W ███░░░░░ 42% ⟳ 4d 12h
```

- `W` / `M` / `Credits` — included credit window from `creditUsagePercent` (or legacy `used`/`monthlyLimit`).
- Detail view also shows prepaid balance, on-demand cap/used, period end, and subscription tier when present.

Bar color: green below 70%, yellow 70–89%, red at 90%+.

## Behavior

- Active footer channel follows the current model provider (`openai-codex` or `xai-supergrok`).
- Fetches on session start and model selection, then polls every 2 minutes.
- Resolves credentials through Pi's model registry (`getApiKeyAndHeaders`), so Pi handles OAuth refresh for both Codex and SuperGrok.
- Grok requests inject cli-chat-proxy product headers (`X-XAI-Token-Auth: xai-grok-cli`, client version/identifier/mode, optional `x-userid` from JWT).
- Transient network failures and request timeouts are retried up to three total attempts with exponential backoff.
- A network warning is shown only after retries fail. The last successful status is kept until the next successful fetch or provider switch.

## Commands

| Command   | Description |
| --------- | ----------- |
| `/usages` | Show detailed plan usage for the active matching model, or the first configured Codex/SuperGrok credentials if the current model is unrelated. |

On success it opens a dismissible detail panel (enter/esc) in TUI mode; otherwise it sends a plain-text summary notification.

## Integration

The status is published under the `usage-bars` key, which `@myagent/responsive-footer` already renders as a dedicated footer line. No configuration file is required.

SuperGrok login / model catalog lives in `@myagent/xai-supergrok`. This package only consumes the stored OAuth credentials through the model registry.
