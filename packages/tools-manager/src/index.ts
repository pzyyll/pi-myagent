// ABOUTME: Registers a /tools-manager command for toggling Pi tools from an interactive settings list.
// ABOUTME: Persists the active tool selection in session entries and restores it across reloads and tree navigation.
import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";

interface ToolsState {
	enabledTools: string[];
}

const CUSTOM_TYPE = "tools-config";

export default function toolsManagerExtension(pi: ExtensionAPI) {
	let enabledTools = new Set<string>();
	let allTools: ToolInfo[] = [];

	function persistState() {
		pi.appendEntry<ToolsState>(CUSTOM_TYPE, {
			enabledTools: Array.from(enabledTools),
		});
	}

	function applyTools() {
		pi.setActiveTools(Array.from(enabledTools));
	}

	function restoreFromBranch(ctx: ExtensionContext) {
		allTools = pi.getAllTools();

		let savedTools: string[] | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
			const data = entry.data as ToolsState | undefined;
			if (Array.isArray(data?.enabledTools)) savedTools = data.enabledTools;
		}

		if (!savedTools) {
			enabledTools = new Set(pi.getActiveTools());
			return;
		}

		const allToolNames = new Set(allTools.map((tool) => tool.name));
		enabledTools = new Set(
			savedTools.filter((tool): tool is string => typeof tool === "string" && allToolNames.has(tool)),
		);
		applyTools();
	}

	pi.registerCommand("tools-manager", {
		description: "Enable/disable tools",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/tools-manager requires TUI mode", "error");
				return;
			}

			allTools = pi.getAllTools();
			enabledTools = new Set(pi.getActiveTools());

			await ctx.ui.custom((tui, theme, _keybindings, done) => {
				const items: SettingItem[] = allTools.map((tool) => ({
					id: tool.name,
					label: tool.name,
					currentValue: enabledTools.has(tool.name) ? "enabled" : "disabled",
					values: ["enabled", "disabled"],
				}));

				const container = new Container();
				container.addChild(new Text(theme.fg("accent", theme.bold("Tool Configuration")), 0, 0));

				const settingsList = new SettingsList(
					items,
					Math.min(items.length + 2, 15),
					getSettingsListTheme(),
					(id, newValue) => {
						if (newValue === "enabled") {
							enabledTools.add(id);
						} else {
							enabledTools.delete(id);
						}
						applyTools();
						persistState();
					},
					() => done(undefined),
					{ enableSearch: true },
				);

				container.addChild(settingsList);

				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						settingsList.handleInput?.(data);
						tui.requestRender();
					},
				};
			});
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});
}
