# pi-myagent

Local pi package for Mr. Julian.

## Included now

- `extensions/collapse-tools.ts` — makes tool call results collapsed by default.
- `extensions/responsive-footer.ts` — keeps all third-party footer statuses visible by wrapping them across multiple lines when they exceed terminal width.

Tool output can still be expanded or collapsed manually with pi's `app.tools.expand` keybinding, which defaults to `Ctrl+O`.

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
