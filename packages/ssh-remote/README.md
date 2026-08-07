# @myagent/ssh-remote

Pi extension that delegates tool operations to a remote machine via SSH.

When `--ssh` is provided, the `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls` tools run on the remote host instead of locally. Without the flag, all tools behave as usual, so the extension is safe to always load.

## Requirements

- SSH key-based auth to the remote host (no password prompts)
- `bash` on the remote
- `rg` (ripgrep) on the remote (for the `grep` and `find` tools)
- `file` on the remote (only for image mime-type detection; degrades gracefully)

## Usage

```bash
# Run in the current project with SSH enabled
pi -e ./src/index.ts --ssh user@host

# Target a specific remote directory (paths are remapped from local cwd)
pi -e ./src/index.ts --ssh user@host:/remote/path
```

Without a path, the remote working directory is resolved via `pwd` over SSH.

## How it works

- Path remapping: local absolute paths are rewritten from the local cwd to the remote cwd.
- `bash` runs as `cd <remote-cwd> && <command>` on the remote; timeout and abort signals are forwarded to the SSH child process.
- `grep` runs `rg` over SSH with `--json`, streaming matches and context lines; limits, line truncation, and notices mirror the built-in grep tool.
- `find` delegates to remote `rg --files` via the tool's `FindOperations` (globs match like fd `--full-path`); relative paths are produced by running inside the remote cwd.
- `ls` delegates to the tool's `LsOperations`: remote `test` stats and `ls -1A` directory listings.
- `!commands` (user bash) also execute remotely when SSH mode is active.
- When `--ssh` is given but the remote cannot be reached (e.g. `pwd` resolution fails), SSH mode fails loudly: a session-start notification and error status are shown, and every remote tool call errors with `SSH mode unavailable` instead of silently running on the local machine.
- The system prompt's `Current working directory:` line is rewritten to the remote cwd (format-tolerant: any cwd line is replaced, or one is appended).
- The TUI status bar shows the active SSH target via `ctx.ui.setStatus`.

## Install

```bash
pi install ./packages/ssh-remote
```

The extension is based on the official Pi example [`examples/extensions/ssh.ts`](https://github.com/earendil-works/pi-coding-agent/blob/main/examples/extensions/ssh.ts).
