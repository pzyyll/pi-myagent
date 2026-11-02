# pi-tools-manager

A [pi coding agent](https://github.com/badlogic/pi-mono) extension that adds a `/tools-manager` command for
interactively enabling and disabling active tools from a TUI settings list.

## What it does

- Registers `/tools-manager` to open a searchable tool toggle list.
- Applies tool changes immediately with `pi.setActiveTools()`.
- Uses Pi's native tool state when the current branch has system messages.
- Keeps native restore results, including `--tools` overrides and new default-active extension tools.
- Restores saved `tools-config` selections only on legacy branches without system messages.

Pi records native tool state on the next model request. `/reload` keeps the current selection, but exiting
before that request can leave the previous selection in the saved session.

## Install

```bash
pi install ./packages/tools-manager
```

## Usage

Run the command in interactive mode:

```text
/tools-manager
```

Use the list to switch individual tools between `enabled` and `disabled`. Use PageUp and PageDown to page
through the list, including in fullscreen mode. The command requires Pi TUI mode.
