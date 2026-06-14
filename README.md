# pi-myagent

Local pi package for Mr. Julian.

## Included now

- `extensions/claude-indicator.ts` — applies a Claude Code-style streaming indicator (`✶ Pouncing…`) with randomized activity verbs.
- `extensions/responsive-footer.ts` — keeps all third-party footer statuses visible by wrapping them across multiple lines when they exceed terminal width.

Use `/claude-indicator refresh` to pick a new verb, or `/claude-indicator reset` to restore Pi's default working indicator.

## Development

Use Bun as the package manager:

```bash
bun install
bun run typecheck
bun run lint
bun run format:check
bun run check
```

## Themes

Theme files are intentionally omitted for now. Add JSON themes later under a `themes/` directory and include them in the `pi.themes` manifest when needed.
