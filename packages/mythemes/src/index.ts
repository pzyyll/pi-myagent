// ABOUTME: Renders Pi's input editor with a shell-style "❯ " prompt on the
// ABOUTME: first content line and a two-space indent on each continuation line.

import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

// "❯","»"
const PROMPT = "»";
const INDENT = " ";
const PREFIX_WIDTH = 1;

function isBorderLine(line: string): boolean {
  // Editor borders and scroll indicators are made of "─" runs.
  return line.includes("─");
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    class PromptPrefixEditor extends CustomEditor {
      constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
        super(tui, theme, keybindings, { paddingX: 0 });
      }

      render(width: number): string[] {
        const innerWidth = Math.max(1, width - PREFIX_WIDTH);
        const lines = super.render(innerWidth);
        if (lines.length === 0) return lines;

        const chevron = ctx.ui.theme.fg("text", PROMPT);
        const borderPad = this.borderColor("─".repeat(PREFIX_WIDTH));

        let firstContentSeen = false;
        return lines.map((line) => {
          if (isBorderLine(line)) {
            return line + borderPad;
          }
          const prefix = firstContentSeen ? INDENT : chevron;
          firstContentSeen = true;
          return prefix + line;
        });
      }
    }

    ctx.ui.setEditorComponent((tui, theme, keybindings) => new PromptPrefixEditor(tui, theme, keybindings));
  });
}
