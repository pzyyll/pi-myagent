# SSH Remote `@` Mentions Implementation Plan

**Goal:** When SSH mode is active, expand interactive `@path` mentions by reading remote files and injecting CLI-compatible `<file name="...">` blocks into the user message.

**Inputs:** User request for remote `@` support; investigation of Pi `cli/file-processor.js` (local-only CLI `@file`), `InputEvent` / `action: "transform"` (verified working), and `packages/ssh-remote` tool path-remapping patterns.

**Assumptions:**

- Scope is **interactive / RPC input** via `pi.on("input")`. CLI argv `@file` (`processFileArguments` in Pi main) stays local-only — no Pi hook exists before process exit on missing local files.
- **Text files only** for v1. Images/binary stay unexpanded (token left as-is). Remote image injection via `InputEventResult.images` is out of scope.
- Token rule: expand only whitespace-delimited tokens that **start with `@`** and whose path part is path-like: absolute (`/...`), relative with `/` or `./` / `../`, or a filename with an extension (`README.md`, `foo.ts`). Bare `@word` is not expanded (avoids casual mentions). Emails like `user@host.com` are not tokens starting with `@`, so they are never candidates.
- Missing remote path, empty remote file, SSH read failure, or non-text content: **leave that `@token` unchanged** (no hard fail of the whole message).
- Max expanded file size: **200 KiB** (`AT_MENTION_MAX_BYTES = 200 * 1024`). Oversized files inject a short notice block instead of full content (safer over SSH than CLI’s unlimited read).
- Path mapping reuses existing semantics: `path.resolve(localCwd, tokenPath).replace(localCwd, remoteCwd)`.
- Injected format matches CLI text files: `` `<file name="${absoluteRemotePath}">\n${content}\n</file>\n` `` (absolute **remote** path in `name`).
- Tests use `bun:test` with injected `readRemote` (no live SSH in unit tests), matching `packages/usage-bar` / `packages/xai-supergrok`.

**Architecture:** Extract a pure, injectable expander module (`at-mentions.ts`) that takes text + remote context + a `readRemote` function and returns either the original text or a transformed string. The extension factory wires `pi.on("input")` only when SSH mode is active (`resolvedSsh` set, not failed), calling the expander with `sshExec`-backed `readRemote`. No changes to tool registration.

**Tech Stack:** TypeScript, Pi extension `InputEvent` / `InputEventResult`, existing `sshExec`, Bun `bun:test`.

---

## File Map

- Create: `packages/ssh-remote/src/at-mentions.ts` — Public expander API: token detection, path resolve, file-block format, `expandAtMentions`, optional thin `createAtMentionInputHandler`.
- Create: `packages/ssh-remote/src/at-mentions.test.ts` — Behavior tests at the public seams (mock `readRemote`).
- Modify: `packages/ssh-remote/src/index.ts` — Register `pi.on("input")` in SSH mode using expander + `sshExec`.
- Modify: `packages/ssh-remote/package.json` — Add `"test": "bun test"`.
- Modify: `packages/ssh-remote/README.md` — Document interactive `@path` remote expansion, limits, and non-goals (CLI `@file`, images).

## Seams

Confirm these before writing tests:

- **Seam A:** `expandAtMentions(text, options)` — Given user text and a `readRemote` impl, returns `{ text, changed }` with remote file contents injected in CLI-compatible blocks, or unchanged text when nothing expands.
- **Seam B:** `createAtMentionInputHandler({ getSsh, localCwd, readRemote })` — Maps Pi `InputEvent` + SSH state to `InputEventResult | void` (`transform` vs no-op).

Internal helpers (token parse, resolve, format) are implementation details of Seam A unless a later slice needs them exported.

## Tasks

### Task 1: Expand a single relative `@path` on successful remote read

**Seam:** A — `expandAtMentions`

**Outcome:** One relative mention expands to a CLI-style file block with remote absolute `name` and file body; surrounding text preserved.

**Files:**

- Create: `packages/ssh-remote/src/at-mentions.ts`
- Create: `packages/ssh-remote/src/at-mentions.test.ts`
- Modify: `packages/ssh-remote/package.json` (add `scripts.test`)

**Steps:**

- [ ] **Red:** Test `expandAtMentions("Review @src/a.ts please", { localCwd: "/home/u/proj", remoteCwd: "/root/proj", readRemote })` where `readRemote("/root/proj/src/a.ts")` resolves to `"hello"`. Expect `changed: true` and text containing:
  - surrounding words `Review` / `please`
  - block `` `<file name="/root/proj/src/a.ts">\nhello\n</file>` ``
  - no leftover `@src/a.ts` token
- [ ] **Green:** Implement minimal `expandAtMentions` + options type + `AT_MENTION_MAX_BYTES` constant; parse one token, resolve path, call `readRemote`, replace token with formatted block.
- [ ] Add `package.json` `"test": "bun test"`.

**Validation:**

- Run (red): `cd packages/ssh-remote && bun test src/at-mentions.test.ts`
- Expected: fail (module/export missing or assertion fail)
- Run (green): same command
- Expected: pass

---

### Task 2: Path mapping for local-absolute and remote-absolute tokens

**Seam:** A — `expandAtMentions`

**Outcome:** Local-cwd-prefixed absolute `@` paths map to remote; pure remote absolutes pass through; both expand when `readRemote` succeeds.

**Files:**

- Modify: `packages/ssh-remote/src/at-mentions.ts`
- Modify: `packages/ssh-remote/src/at-mentions.test.ts`

**Steps:**

- [ ] **Red:**  
  1. `@/home/u/proj/src/a.ts` + `localCwd=/home/u/proj`, `remoteCwd=/root/proj` → `readRemote` called with `/root/proj/src/a.ts`, block name is that remote path.  
  2. `@/tmp/remote-only.ts` → `readRemote` called with `/tmp/remote-only.ts` (no localCwd rewrite).
- [ ] **Green:** Use `path.resolve(localCwd, tokenPath).replace(localCwd, remoteCwd)` (same as tools).

**Validation:**

- Run (red): `cd packages/ssh-remote && bun test src/at-mentions.test.ts`
- Expected: new cases fail until mapping implemented
- Run (green): same command — all pass

---

### Task 3: Non-expansion cases (missing, empty, error, non-path tokens)

**Seam:** A — `expandAtMentions`

**Outcome:** Unsafe or failed expansions leave the original token; whole message is not rejected.

**Files:**

- Modify: `packages/ssh-remote/src/at-mentions.ts`
- Modify: `packages/ssh-remote/src/at-mentions.test.ts`

**Steps:**

- [ ] **Red:**  
  1. `readRemote` rejects / returns null → text unchanged, `changed: false`.  
  2. Empty content `""` → leave `@path` unchanged (`changed: false` for that alone).  
  3. Bare `@todo` (no `/`, no extension) → unchanged.  
  4. Mixed: `"see @missing.ts and @src/ok.ts"` with only `ok` readable → only `ok` expands; `@missing.ts` remains.
- [ ] **Green:** Treat null/throw/empty as skip-token; token detector requires path-like form.

**Validation:**

- Run (red/green): `cd packages/ssh-remote && bun test src/at-mentions.test.ts`
- Expected: red then green for the new cases

---

### Task 4: Oversized files and multi-token expansion order

**Seam:** A — `expandAtMentions`

**Outcome:** Multiple path-like tokens expand left-to-right; oversized content injects a notice block instead of full body.

**Files:**

- Modify: `packages/ssh-remote/src/at-mentions.ts`
- Modify: `packages/ssh-remote/src/at-mentions.test.ts`

**Steps:**

- [ ] **Red:**  
  1. Two valid mentions expand independently; order preserved.  
  2. Content longer than `AT_MENTION_MAX_BYTES` → block name still remote path; body is a fixed notice string (e.g. includes `truncated` / size limit), not the full payload; `readRemote` may still be called (or optional size probe — **prefer single `readRemote` then truncate notice if over limit** to keep the injected reader simple).
- [ ] **Green:** Implement sequential replace; if `Buffer.byteLength(content, "utf8") > AT_MENTION_MAX_BYTES`, use notice body.

**Validation:**

- Run (red/green): `cd packages/ssh-remote && bun test src/at-mentions.test.ts`
- Expected: red then green

---

### Task 5: Input handler seam (SSH on/off)

**Seam:** B — `createAtMentionInputHandler`

**Outcome:** No SSH → handler returns `undefined` / no transform. SSH active → returns `{ action: "transform", text }` when expansion changes text; returns nothing when text has no expandable mentions.

**Files:**

- Modify: `packages/ssh-remote/src/at-mentions.ts`
- Modify: `packages/ssh-remote/src/at-mentions.test.ts`

**Steps:**

- [ ] **Red:**  
  1. `getSsh() === null` → `await handler({ type: "input", text: "@src/a.ts", source: "interactive" })` is `undefined`.  
  2. `getSsh()` returns target, `readRemote` succeeds → result `{ action: "transform", text: expect.stringContaining("<file name=") }`.  
  3. SSH active but no `@path` → `undefined` (avoid no-op transform).
- [ ] **Green:** Export `createAtMentionInputHandler({ getSsh, localCwd, readRemote })` wrapping Seam A.

**Validation:**

- Run (red/green): `cd packages/ssh-remote && bun test src/at-mentions.test.ts`
- Expected: red then green

---

### Task 6: Wire into extension + docs

**Seam:** B (integration at `packages/ssh-remote/src/index.ts`)

**Outcome:** Real extension uses expander in SSH mode with `sshExec`-backed remote read; README documents behavior.

**Files:**

- Modify: `packages/ssh-remote/src/index.ts`
- Modify: `packages/ssh-remote/README.md`

**Steps:**

- [ ] In factory, after SSH state is defined, register:

```ts
pi.on("input", createAtMentionInputHandler({
  getSsh: () => (!sshFailure ? resolvedSsh : null), // non-throwing; failed mode does not transform
  localCwd,
  readRemote: async (remotePath) => {
    // implement: ssh cat; map failure → null
  },
}));
```

- [ ] `readRemote` implementation notes:
  - Command: `cat ${JSON.stringify(remotePath)}` via existing `sshExec`
  - On non-zero / throw → return `null`
  - Decode buffer as `utf-8`
  - Do **not** call `getSsh()` that throws on failure — use the non-throwing accessor so a dead SSH session does not turn every input into an extension error (tools already fail loudly)
- [ ] README: document interactive `@path` remote expansion, token rules, 200 KiB limit, missing-file leave-as-is, CLI `@file` still local-only, images not supported.

**Validation:**

- Run: `cd packages/ssh-remote && bun test`
- Expected: all tests pass
- Run: `bun run check` (repo root)
- Expected: typecheck + lint + format pass
- Manual (optional, if SSH target available):  
  `pi -e ./packages/ssh-remote/src/index.ts --ssh user@host:/path` then type `summarize @src/index.ts` → model sees file block with remote content.

## Final Validation

- Run: `cd packages/ssh-remote && bun test`
- Expected: all `at-mentions` tests pass (red-green history per task)
- Run: `bun run check`
- Expected: clean typecheck, eslint, prettier
- Spec coverage check: interactive remote `@` yes; CLI `@file` explicitly out of scope in README; images out of scope; silent local fallback on SSH failure still avoided for tools (unchanged)

## Failure Behavior

| Case | Behavior |
|------|----------|
| SSH mode off / not requested | Input handler no-ops; Pi default behavior |
| SSH requested but failed (`sshFailure`) | No `@` transform; tools still error with `SSH mode unavailable` |
| Remote path missing / unreadable | Leave `@token` in text |
| Empty remote file | Leave `@token` |
| File > 200 KiB | Inject notice block, not full content |
| Multiple tokens, partial success | Expand successes only |
| CLI `pi @remote/path` | Unchanged (local fs); document limitation |

## Privacy and Security

- Remote file contents enter the chat transcript and model context — same trust model as local CLI `@file`.
- Do not log full file bodies from the expander.
- `JSON.stringify` shell-quoting for remote paths (same as other ssh-remote ops).

## Rollout Notes

- No migration. Enable by loading ssh-remote with `--ssh` as today.
- Package-local tests: `cd packages/ssh-remote && bun test` (add script in Task 1).

## Risks and Mitigations

- **False-positive expansion of `@something`** — Mitigate with path-like token rules; bare words skipped.
- **Large remote files over SSH** — 200 KiB cap + notice.
- **Blocking input on slow SSH** — Acceptable for v1; document; future: timeout on `readRemote` if needed.
- **CLI `@file` still local** — Document clearly so users are not surprised.

## Open Questions

None blocking. Confirm seams A/B before implementation if any token-rule or size-limit preference differs from Assumptions.
