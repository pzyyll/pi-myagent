// ABOUTME: Tests tools-manager restoration against Pi's real session and extension runtime.
// ABOUTME: Covers native loadouts, legacy branches, reloads, and fullscreen list paging.
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createCodingTools,
  createReadTool,
  DefaultResourceLoader,
  initTheme,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
  type KeybindingsManager as PiKeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { ProcessTerminal, TuiAltScreen } from "@earendil-works/pi-tui";
import toolsManager from "../src/index";

const cleanups: Array<() => void> = [];
const PAGE_TOOL_COUNT = 24;
const RENDER_WIDTH = 80;
const PAGE_DOWN = "\x1b[6~";
const PAGE_UP = "\x1b[5~";
const ENTER = "\r";
const ESCAPE = "\x1b";

function recordTools(manager: SessionManager, names: string[]) {
  const tools = createCodingTools(manager.getCwd());
  return manager.appendMessage({
    role: "system",
    content: "",
    toolsAdded: names.map((name) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return { name, description: tool.description, parameters: tool.parameters };
    }),
    timestamp: Date.now(),
  });
}

function recordLegacy(manager: SessionManager, enabledTools: unknown[]) {
  return manager.appendCustomEntry("tools-config", { enabledTools });
}

async function fixture(
  seed: (manager: SessionManager) => void = () => {},
  options: Pick<CreateAgentSessionOptions, "tools" | "customTools"> = {},
) {
  const cwd = mkdtempSync(join(tmpdir(), "tools-manager-"));
  cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
  const manager = SessionManager.inMemory(cwd);
  seed(manager);
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    extensionFactories: [toolsManager],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  expect(resourceLoader.getExtensions().errors).toEqual([]);
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    sessionManager: manager,
    settingsManager,
    resourceLoader,
    modelRuntime,
    model: modelRuntime.getModels()[0],
    ...options,
  });
  cleanups.push(() => session.dispose());
  const errors: unknown[] = [];
  await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
  return { session, manager, errors };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe("tools-manager restoration", () => {
  it("keeps the default tools when no selection is saved", async () => {
    const { session, errors } = await fixture();
    expect(session.getActiveToolNames()).toEqual(["read", "bash", "edit", "write"]);
    expect(errors).toEqual([]);
  });

  it("restores the latest legacy selection and filters unavailable or invalid names", async () => {
    const { session } = await fixture((manager) => {
      recordLegacy(manager, ["bash"]);
      recordLegacy(manager, ["read", "missing", null, "read"]);
    });
    expect(session.getActiveToolNames()).toEqual(["read"]);
  });

  it("restores an explicitly empty legacy selection", async () => {
    const { session } = await fixture((manager) => recordLegacy(manager, []));
    expect(session.getActiveToolNames()).toEqual([]);
  });

  it("does not replace a newer native loadout with an old snapshot", async () => {
    const { session } = await fixture((manager) => {
      recordLegacy(manager, ["bash"]);
      recordTools(manager, ["read"]);
    });
    expect(session.getActiveToolNames()).toEqual(["read"]);
  });

  it("uses native state even when the custom snapshot is newer", async () => {
    const { session } = await fixture((manager) => {
      recordTools(manager, ["read"]);
      recordLegacy(manager, ["bash"]);
    });
    expect(session.getActiveToolNames()).toEqual(["read"]);
  });

  it("keeps an empty native loadout without tool delta fields", async () => {
    const { session } = await fixture((manager) => {
      recordLegacy(manager, ["bash"]);
      manager.appendMessage({ role: "system", content: "Prompt", timestamp: Date.now() });
    });
    expect(session.getActiveToolNames()).toEqual([]);
  });

  it.each([
    { tools: ["+write"], expected: ["read", "write"] },
    { tools: ["-read"], expected: [] },
    { tools: ["read", "bash"], expected: ["read", "bash"] },
  ])("preserves the tools option %j", async ({ tools, expected }) => {
    const { session } = await fixture(
      (manager) => {
        recordTools(manager, ["read"]);
        recordLegacy(manager, ["read"]);
      },
      { tools: [...tools] },
    );
    expect(session.getActiveToolNames()).toEqual([...expected]);
  });

  it("keeps a newly registered default-active tool", async () => {
    const extraTool = { ...createReadTool(process.cwd()), name: "extra_read", label: "Extra Read" };
    const { session } = await fixture(
      (manager) => {
        recordTools(manager, ["read"]);
        recordLegacy(manager, ["read"]);
      },
      { customTools: [extraTool] },
    );
    expect(session.getActiveToolNames()).toContain("extra_read");
  });

  it.each([false, true])("keeps live tools across reload (native branch: %j)", async (native: boolean) => {
    const { session, errors } = await fixture((manager) => {
      if (native) recordTools(manager, ["read"]);
      recordLegacy(manager, ["read"]);
    });
    session.setActiveToolsByName(["bash"]);
    await session.reload();
    expect(session.getActiveToolNames()).toEqual(["bash"]);
    expect(errors).toEqual([]);
  });

  it("uses native state after tree navigation and compaction", async () => {
    let target = "";
    const { session, manager, errors } = await fixture((manager) => {
      recordLegacy(manager, ["bash"]);
      recordTools(manager, ["read"]);
      target = manager.appendCompaction("Summary", null, 0);
      recordTools(manager, ["bash"]);
    });
    await session.navigateTree(target, { summarize: false });
    expect(session.getActiveToolNames()).toEqual(["read"]);
    expect(manager.getLeafId()).toBe(target);
    expect(errors).toEqual([]);
  });

  it("restores a legacy selection after tree navigation", async () => {
    let target = "";
    const { session, errors } = await fixture((manager) => {
      target = recordLegacy(manager, ["read"]);
      recordLegacy(manager, ["bash"]);
    });
    expect(session.getActiveToolNames()).toEqual(["bash"]);
    await session.navigateTree(target, { summarize: false });
    expect(session.getActiveToolNames()).toEqual(["read"]);
    expect(errors).toEqual([]);
  });
});

describe("tools-manager settings list", () => {
  it("captures fullscreen paging, pages the real list, and applies toggles", async () => {
    initTheme("dark", false);
    const customTools = Array.from({ length: PAGE_TOOL_COUNT }, (_, index) => ({
      ...createReadTool(process.cwd()),
      name: `extra_read_${index}`,
      label: `Extra Read ${index}`,
    }));
    const { session, manager, errors } = await fixture(() => {}, { customTools });
    const ui = session.extensionRunner.getUIContext();
    const tui = new TuiAltScreen(new ProcessTerminal());
    const { KeybindingsManager } = (await import(
      new URL("./core/keybindings.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href
    )) as { KeybindingsManager: new () => PiKeybindingsManager };
    const keybindings = new KeybindingsManager();
    let opened = false;
    await session.bindExtensions({
      mode: "tui",
      uiContext: {
        ...ui,
        async custom<T>(factory: Parameters<typeof ui.custom<T>>[0]) {
          opened = true;
          let closed = false;
          let complete!: (value: T) => void;
          const result = new Promise<T>((resolve) => {
            complete = resolve;
          });
          const component = await factory(tui, ui.theme, keybindings, (value) => {
            closed = true;
            complete(value);
          });
          expect(component.capturesViewportInput).toBe(true);
          const initial = component.render(RENDER_WIDTH);
          component.handleInput?.(PAGE_DOWN);
          expect(component.render(RENDER_WIDTH)).not.toEqual(initial);
          component.handleInput?.(PAGE_UP);
          expect(component.render(RENDER_WIDTH)).toEqual(initial);
          const activeBefore = session.getActiveToolNames();
          component.handleInput?.(ENTER);
          expect(session.getActiveToolNames()).not.toEqual(activeBefore);
          expect(manager.getBranch().at(-1)).toMatchObject({
            type: "custom",
            customType: "tools-config",
            data: { enabledTools: expect.arrayContaining(session.getActiveToolNames()) },
          });
          component.handleInput?.(ESCAPE);
          expect(closed).toBe(true);
          return result;
        },
      },
    });
    await session.prompt("/tools-manager");
    expect(opened).toBe(true);
    expect(errors).toEqual([]);
  });
});
