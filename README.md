# pi-myagent

Local pi package for Mr. Julian.

## Included now

- `extensions/claude-indicator.ts` — applies a Claude Code-style streaming indicator (`✶ Pouncing…`) with randomized activity verbs.
- `extensions/responsive-footer.ts` — keeps all third-party footer statuses visible by wrapping them across multiple lines when they exceed terminal width.

Use `/claude-indicator refresh` to pick a new verb, or `/claude-indicator reset` to restore Pi's default working indicator.

### Configuration

`claude-indicator` reads an optional `claudeIndicator` section from your settings JSON. Project settings (`<cwd>/.pi/settings.json`) override global settings (`~/.pi/agent/settings.json`):

```json
{
	"claudeIndicator": {
		"defaultColor": "accent",
		"thinkingShimmerColor": "warning",
		"shimmerHueShift": 0,
		"shimmerLightnessBoost": 0.36
	}
}
```

| Key                     | Type   | Default     | Description                                                                                                     |
| ----------------------- | ------ | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `defaultColor`          | string | `"accent"`  | Spinner/message colour. A theme colour name (e.g. `accent`, `warning`) or a hex literal (`#rrggbb` / `#rgb`).   |
| `thinkingShimmerColor`  | string | `"warning"` | Target colour the breathing "thinking" text ramps toward. Theme name or hex, same as above.                     |
| `shimmerHueShift`       | number | `0`         | Degrees to rotate the shimmer hue around the colour wheel (`0`/`360` = same colour, `180` = complementary).     |
| `shimmerLightnessBoost` | number | `0.36`      | Fraction (`0`–`1`) to lift the shimmer's lightness after the hue rotation; `0` = pure hue shift, no extra glow. |

Invalid or missing values fall back to the defaults above.

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
