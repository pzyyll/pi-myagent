import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Keep tool call results collapsed by default.
 * Users can still toggle visibility with the configured `app.tools.expand`
 * keybinding, which is Ctrl+O by default.
 */
function collapseTools(ctx: { ui: { setToolsExpanded(expanded: boolean): void } }) {
  ctx.ui.setToolsExpanded(false);
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    collapseTools(ctx);
  });

  // Also applies after `/reload`: the next tool call returns to collapsed mode,
  // but manual Ctrl+O expansion still works after the result appears.
  pi.on("tool_call", (_event, ctx) => {
    collapseTools(ctx);
  });
}
