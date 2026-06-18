# myagent-monorepo

Mr. Julian's monorepo of [Pi](https://pi.dev) extension and theme packages.

Each subpackage in `packages/` is independently installable via `pi install <path>`.

## Packages

| Package                      | Type      | Description                                                                                         |
| ---------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `@myagent/ccswitch-provider` | extension | Wires the local `ccswitch` provider with Claude Code billing headers.                               |
| `@myagent/claude-indicator`  | extension | Claude Code-style streaming indicator (`✶ Pouncing…`) with randomized verbs and themeable colours.  |
| `@myagent/responsive-footer` | extension | Wraps third-party footer status segments across multiple lines so they stay visible on narrow TTYs. |
| `@myagent/system-prompts`    | extension | Appends Mr. Julian's developer instructions to the Pi system prompt.                                |
| `@myagent/ansi-themes`       | theme     | Dark and light themes that follow the terminal's ANSI palette.                                      |

### `claude-indicator` configuration

`claude-indicator` reads an optional `claudeIndicator` section from settings JSON. Project settings (`<cwd>/.pi/settings.json`) override global settings (`~/.pi/agent/settings.json`):

```json
{
	"claudeIndicator": {
		"defaultColor": "accent",
		"thinkingShimmerColor": "warning",
		"shimmerHueShift": 0,
		"shimmerLightnessBoost": 0.36,
		"flashHueShift": 30,
		"stallColor": "error"
	}
}
```

| Key                     | Type   | Default     | Description                                                                                                   |
| ----------------------- | ------ | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `defaultColor`          | string | `"accent"`  | Spinner/message colour. A theme colour name (e.g. `accent`, `warning`) or a hex literal (`#rrggbb` / `#rgb`). |
| `thinkingShimmerColor`  | string | `"warning"` | Target colour the breathing "thinking" text ramps toward.                                                     |
| `shimmerHueShift`       | number | `0`         | Degrees to rotate the glimmer-sweep shimmer hue around the colour wheel.                                      |
| `shimmerLightnessBoost` | number | `0.36`      | Fraction (`0`–`1`) to lift the shimmer's lightness after the hue rotation.                                    |
| `flashHueShift`         | number | `30`        | Degrees to rotate the hue of the tool-use flash's end colour, independent of `shimmerHueShift`.               |
| `stallColor`            | string | `"error"`   | Colour the spinner/message fades toward when output stalls (~3s idle with no tools running).                  |

Use `/claude-indicator refresh` to pick a new verb, or `/claude-indicator reset` to restore Pi's default working indicator.

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
pi install ./packages/ansi-themes
```
