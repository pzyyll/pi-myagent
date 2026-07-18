# @myagent/auto-session-name

Auto-generates a session title from the first meaningful exchange and applies it via `pi.setSessionName()`.
The title appears in the footer, terminal title bar, and `/resume` selector — same place as a manually set
`/name`.

## Behavior

- Listens for `agent_end` (fired once per user prompt after the agent loop finishes).
- Skips if the session already has a name (manual `/name` always wins).
- Skips until there is at least one user message (≥ 8 chars) and one assistant text response.
- Calls a one-shot summary model and writes the result via `setSessionName`. Preference order:
  configured `model` (or the active session model if unset) → each `fallbackModels` entry → active
  session model only when a configured primary was missing and no fallback resolved.
- On model-not-found, missing API key, or call failure, tries the next candidate in that order.
- Records the attempt per session so it does not retry on every later turn — re-run manually with
  `/auto-name` if you want a fresh title.

## Commands

| Command      | Behaviour                                                                  |
| ------------ | -------------------------------------------------------------------------- |
| `/auto-name` | Force regenerate the title from the current conversation, ignoring guards. |

## Configuration

Optional `~/.pi/agent/@myagent/auto-session-name/config.json`:

```json
{
  "enabled": true,
  "maxLength": 40,
  "style": "concise",
  "prompt": "...",
  "model": "openai/gpt-5.4-mini",
  "fallbackModels": ["openai/gpt-4.1-mini", "anthropic/claude-haiku-4-5"]
}
```

| Key              | Type                         | Default     | Notes                                                                                                     |
| ---------------- | ---------------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| `enabled`        | `boolean`                    | `true`      | Set `false` to disable auto-naming. `/auto-name` still works.                                             |
| `maxLength`      | `number` (1–120)             | `40`        | Soft cap; oversize titles are truncated with `…`.                                                         |
| `style`          | `"concise" \| "descriptive"` | `"concise"` | Picks the built-in prompt template.                                                                       |
| `prompt`         | `string`                     | —           | Full custom prompt. Use `{max}` as a placeholder for `maxLength`.                                         |
| `model`          | `string`                     | —           | Preferred `provider/modelId` (e.g. `openai/gpt-5.4-mini`). Unset → active session model.                  |
| `fallbackModels` | `string[]`                   | `[]`        | Ordered `provider/modelId` list tried when the preferred model is missing, has no key, or the call fails. |

## Notes

- Defaults to the active session model (`ctx.model`). Configure `model` / `fallbackModels` for dedicated (and backup) models.
- A preferred model that is not registered is skipped; entries in `fallbackModels` are tried next. If the preferred model was set but nothing resolved, the active session model is used as a last resort (same as before).
- No API key for a candidate → that candidate is skipped and the next one is tried. If every candidate fails, a single warning lists the failures.
- The summary call honours the agent's abort signal, so Esc cancels it (including mid-fallback chain).
- Output is sanitised: leading/trailing quotes, trailing punctuation, and extra lines are stripped.
