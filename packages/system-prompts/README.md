# pi-system-prompts

A [pi coding agent](https://github.com/badlogic/pi-mono) extension that appends Mr. Julian's developer
instructions to the Pi system prompt before each agent run.

## What it does

On `before_agent_start`, reads `rules/system-append.gpt55.md` from the package and appends it to the
incoming system prompt, wrapped in `<!-- > Dev Instructions -->` … `<!-- Dev Instructions -->` markers. The
rules file is loaded once and cached for the session.
