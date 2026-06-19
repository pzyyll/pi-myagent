# pi-claude-indicator

A Claude Code-style streaming working indicator for the [pi coding agent](https://github.com/badlogic/pi-mono),
with randomized verbs (`✶ Pouncing…`) and themeable colours. Replaces Pi's default working indicator with
the glimmer-sweep, breathing "thinking" ramp, tool-use flash, and stall fade modelled on Claude Code.

## Commands

`/claude-indicator` registers a slash command:

| Action    | Behaviour                                                                            |
| --------- | ------------------------------------------------------------------------------------ |
| `on`      | Enable the Claude indicator (also the default when no action is given).              |
| `refresh` | Pick a new random verb and restart the indicator.                                    |
| `reset`   | Disable the indicator and restore Pi's default (`off` / `default` are aliases).      |
| `preview` | Render every indicator phase against a virtual clock in a widget; run again to stop. |

## Configuration

`claude-indicator` reads optional `~/.pi/agent/@myagent/claude-indicator/config.json`:

```json
{
	"defaultColor": "accent",
	"thinkingShimmerColor": "warning",
	"shimmerHueShift": 10,
	"shimmerLightnessBoost": 0.3,
	"flashHueShift": 30,
	"stallColor": "error"
}
```

| Key                     | Type   | Default     | Description                                                                                                   |
| ----------------------- | ------ | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `defaultColor`          | string | `"accent"`  | Spinner/message colour. A theme colour name (e.g. `accent`, `warning`) or a hex literal (`#rrggbb` / `#rgb`). |
| `thinkingShimmerColor`  | string | `"warning"` | Target colour the breathing "thinking" text ramps toward.                                                     |
| `shimmerHueShift`       | number | `10`        | Degrees to rotate the glimmer-sweep shimmer hue around the colour wheel.                                      |
| `shimmerLightnessBoost` | number | `0.3`       | Fraction (`0`–`1`) to lift the shimmer's lightness after the hue rotation.                                    |
| `flashHueShift`         | number | `30`        | Degrees to rotate the hue of the tool-use flash's end colour, independent of `shimmerHueShift`.               |
| `stallColor`            | string | `"error"`   | Colour the spinner/message fades toward when output stalls (~3s idle with no tools running).                  |
