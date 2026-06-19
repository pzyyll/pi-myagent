# @myagent/auto-session-name

Auto-generates a session title from the first meaningful exchange and applies it via `pi.setSessionName()`.
The title appears in the footer, terminal title bar, and `/resume` selector — same place as a manually set
`/name`.

## Behavior

- Listens for `agent_end` (fired once per user prompt after the agent loop finishes).
- Skips if the session already has a name (manual `/name` always wins).
- Skips until there is at least one user message (≥ 8 chars) and one assistant text response.
- Calls the **current session model** with a one-shot summary prompt and writes the result via
  `setSessionName`.
- Records the attempt per session so it does not retry on every later turn — re-run manually with
  `/auto-name` if you want a fresh title.

## Commands

| Command      | Behaviour                                                                  |
| ------------ | -------------------------------------------------------------------------- |
| `/auto-name` | Force regenerate the title from the current conversation, ignoring guards. |

## Configuration

Optional `~/.pi/agent/@pi-myagent/auto-session-name/config.json`:

```json
{
	"enabled": true,
	"maxLength": 40,
	"style": "concise",
	"prompt": "...",
	"model": "openai/gpt-4o-mini"
}
```

| Key         | Type                         | Default     | Notes                                                                                  |
| ----------- | ---------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `enabled`   | `boolean`                    | `true`      | Set `false` to disable auto-naming. `/auto-name` still works.                          |
| `maxLength` | `number` (1–120)             | `40`        | Soft cap; oversize titles are truncated with `…`.                                      |
| `style`     | `"concise" \| "descriptive"` | `"concise"` | Picks the built-in prompt template.                                                    |
| `prompt`    | `string`                     | —           | Full custom prompt. Use `{max}` as a placeholder for `maxLength`.                      |
| `model`     | `string`                     | —           | `provider/modelId` (e.g. `openai/gpt-4o-mini`). Falls back to active model if missing. |

## Notes

- Defaults to the active session model (`ctx.model`). Configure `model` to use a dedicated one. No API key for the chosen provider → noop with a notification.
- The summary call honours the agent's abort signal, so Esc cancels it.
- Output is sanitised: leading/trailing quotes, trailing punctuation, and extra lines are stripped.
