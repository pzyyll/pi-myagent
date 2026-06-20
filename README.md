# myagent-monorepo

Mr. Julian's monorepo of [Pi](https://pi.dev) extension and theme packages.

Each subpackage in `packages/` is independently installable via `pi install <path>`.

## Packages

| Package                                                    | Type      | Description                                                                                         |
| ---------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| [`@myagent/ccswitch-provider`](packages/ccswitch-provider) | extension | Wires the local `ccswitch` provider with Claude Code billing headers.                               |
| [`@myagent/claude-indicator`](packages/claude-indicator)   | extension | Claude Code-style streaming indicator (`✶ Pouncing…`) with randomized verbs and themeable colours.  |
| [`@myagent/responsive-footer`](packages/responsive-footer) | extension | Wraps third-party footer status segments across multiple lines so they stay visible on narrow TTYs. |
| [`@myagent/system-prompts`](packages/system-prompts)       | extension | Appends Mr. Julian's developer instructions to the Pi system prompt.                                |
| [`@myagent/tools-manager`](packages/tools-manager)         | extension | Adds a `/tools-manager` TUI for interactively enabling and disabling active tools.                  |
| [`@myagent/ansi-themes`](packages/ansi-themes)             | theme     | Dark and light themes that follow the terminal's ANSI palette.                                      |

See each package's `README.md` for configuration and usage details.

## Development

This repo uses [bun workspaces](https://bun.com/docs/install/workspaces) and [mise](https://mise.jdx.dev) for tool versions.

```bash
mise install            # install pinned node + bun
bun install             # link workspace packages
bun run typecheck
bun run lint
bun run format:check
bun run check           # all of the above
```

## Local install into Pi

Each package is independent:

```bash
pi install ./packages/ccswitch-provider
pi install ./packages/claude-indicator
pi install ./packages/responsive-footer
pi install ./packages/system-prompts
pi install ./packages/tools-manager
pi install ./packages/ansi-themes
```
