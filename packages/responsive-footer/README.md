# pi-responsive-footer

A [pi coding agent](https://github.com/badlogic/pi-mono) extension that wraps third-party footer status
segments across multiple lines so they stay visible on narrow terminals.

## What it does

Replaces Pi's footer on `session_start` with a renderer that:

- draws the default footer — cwd (as `~`-relative path, with git branch and session name), the model line,
  and usage stats (input/output, cache read/write, cache-hit rate, cost, and context-window percentage),
- puts `usage-bars` / `pi-usage-bars` extension statuses on their own line,
- word-wraps any remaining extension statuses onto as many lines as needed, instead of letting a single
  over-long status truncate or push content off-screen.
