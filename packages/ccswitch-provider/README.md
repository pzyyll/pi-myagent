# pi-ccswitch-provider

A [pi coding agent](https://github.com/badlogic/pi-mono) extension that wires the local `ccswitch` provider
with Claude Code billing headers, so requests to a local Claude Code-compatible endpoint look like they
originate from Claude Code itself.

## What it does

- Registers a `ccswitch` provider pointing at `http://127.0.0.1:15721` (Anthropic Messages API), exposing
  `claude-opus-4-8`, `claude-sonnet-4-6`, and `claude-haiku-4-5-20251001` with zero-cost accounting.
- On every `before_provider_request` for a `ccswitch` + `claude-*` model, injects:
  - the Claude Code billing header and the `You are Claude Code, Anthropic's official CLI for Claude.`
    system prefix (with ephemeral cache control),
  - a `user_id` metadata blob built from `~/.claude.json` (`userID` → `device_id`,
    `oauthAccount.accountUuid` → `account_uuid`) plus the current Pi session id,
  - a `clear_thinking_20251015` context-management edit.

Identity is read once from `~/.claude.json` and cached for the session; a random `device_id` is generated
when the file or `userID` is missing.
