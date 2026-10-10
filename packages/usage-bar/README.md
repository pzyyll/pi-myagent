# @myagent/usage-bar

A Pi extension that shows subscription usage as a footer status bar and detailed `/usages` panel. It supports multiple channels behind one pipeline:

| Channel         | Provider id     | Auth    | Source                                                          |
| --------------- | --------------- | ------- | --------------------------------------------------------------- |
| **Codex**       | `openai-codex`  | OAuth   | `GET https://chatgpt.com/backend-api/wham/usage`                |
| **Grok**        | `xai-supergrok` | OAuth   | `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` |
| **OpenCode Go** | `opencode-go`   | API key | `GET https://opencode.ai/zen/go/v1/usage`                       |

The footer appears only while a matching model is active. `/usages` is independent of the current model: it opens a channel select list and queries the chosen channel on demand.

## What it shows

### Codex

```
Codex 5h ███░░░░░ 38% ⟳ 2h  W ██████░░ 75% ⟳ 5d
```

- `5h` — five-hour rolling window (`primary_window`).
- `W` — weekly rolling window (`secondary_window`).
- When any window reaches `100%` and finite credits remain, the footer prepends the balance, e.g. `Codex $40.14(1,003.48) W ...`.

### Grok (SuperGrok OAuth)

```
Grok W ███░░░░░ 42% ⟳ 4d 12h
```

- `W` / `M` / `Credits` — included credit window from `creditUsagePercent` (or legacy `used`/`monthlyLimit`).
- Detail view also shows prepaid balance, on-demand cap/used, period end, subscription tier, and `productUsage` breakdown (API / Build / Chat / Imagine / Voice) when present.

### OpenCode Go

```
Go 5h ░░░░░░░░ 0% ⟳ 4h 57m  W ░░░░░░░░ 0% ⟳ 4d 14h  M ██░░░░░░ 31% ⟳ 18d 23h
```

- `5h` - rolling five-hour window (`usage.rolling`).
- `W` - weekly window (`usage.weekly`).
- `M` - monthly window (`usage.monthly`).
- Auth is the same OpenCode Go API key used for model requests (`Authorization: Bearer …`).
- Detail view flags any window with `status: "rate-limited"`.

Bar color: green below 70%, yellow 70–89%, red at 90%+.

## Behavior

- Active footer channel follows the current model provider.
- OAuth channels (`openai-codex`, `xai-supergrok`) poll only while that provider is authenticated via OAuth. API-key / BYOK mode for those providers does not poll: their billing APIs reject API keys with HTTP 401.
- OpenCode Go (`opencode-go`) polls with the configured API key.
- Fetches on session start and model selection, then polls every 2 minutes.
- Keeps the last successful result for each channel in memory. Switching models shows that channel's cached status immediately. The extension queries a channel immediately if its cache is missing or older than 2 minutes.
- Clears the cache when the session shuts down. The extension does not write the cache to disk.
- Resolves credentials through Pi's model registry (`getApiKeyAndHeaders`), so Pi handles OAuth refresh for Codex and SuperGrok.
- Grok requests inject cli-chat-proxy product headers (`X-XAI-Token-Auth: xai-grok-cli`, client version/identifier/mode, optional `x-userid` from JWT).
- Transient network failures and request timeouts are retried up to three total attempts with exponential backoff.
- A network warning is shown only after retries fail. The last successful status is kept until the next successful fetch or provider switch.

## Commands

| Command   | Description                                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/usages` | Open a select list of supported channels (Codex, SuperGrok, OpenCode Go) and show detailed plan usage for the chosen channel. Works regardless of the selected model. |

On success it opens a dismissible detail panel (enter/esc) in TUI mode; otherwise it sends a plain-text summary notification.

## Integration

The status is published under the `usage-bars` key, which `@myagent/responsive-footer` already renders as a dedicated footer line. No configuration file is required.

SuperGrok login / model catalog lives in `@myagent/xai-supergrok`. This package only consumes stored credentials through the model registry.
