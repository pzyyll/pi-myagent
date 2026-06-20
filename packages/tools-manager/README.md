# pi-tools-manager

A [pi coding agent](https://github.com/badlogic/pi-mono) extension that adds a `/tools-manager` command for
interactively enabling and disabling active tools from a TUI settings list.

## What it does

- Registers `/tools-manager` to open a searchable tool toggle list.
- Applies tool changes immediately with `pi.setActiveTools()`.
- Persists the selected tool set in the current session branch.
- Restores the selection after `/reload` and session tree navigation.

## Install

```bash
pi install ./packages/tools-manager
```

## Usage

Run the command in interactive mode:

```text
/tools-manager
```

Use the list to switch individual tools between `enabled` and `disabled`. The command requires Pi TUI mode.
