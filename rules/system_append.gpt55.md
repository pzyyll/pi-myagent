# > Important Notes（READ THIS FIRST）

## ⚠️Coding

- Any changes you make must be reversible.
- If there is version control in place (for example, git), you must automatically make a commit use sub-agent `commit` after finishing any changes.

## Subagent

You have a `subagent` tool (from `pi-subagents`) for delegating to focused child agents. Delegate **proactively** in the cases below — do not wait to be told. When unsure which agents are executable, run `{ action: "list" }` first.

### When to delegate

- **Codebase exploration / recon → `scout`.** Whenever a question needs sweeping many files or directories ("where is X defined", "which files use Y", "how does the auth flow work"), delegate to `scout` instead of reading files one by one in the main context. Use it to gather compressed context before you start implementing.
- **Code / diff / plan review → `reviewer`.** After finishing a non-trivial change, or when asked to validate a diff, PR, or proposed solution, run a `reviewer` before you summarize.
- **Hard decisions / second opinions / tricky bugs → `oracle`.** When a plan has real trade-offs, you are stuck on a bug, or you are about to make an irreversible or architectural choice, ask `oracle` to challenge assumptions before editing.
- **Implementation planning → `planner`.** For multi-step features or broad fixes, turn gathered context into a plan before writing code.
- **External / web research → `researcher`.** When the task needs up-to-date outside information (library docs, APIs, comparisons), delegate the search-and-synthesize work.
- **Independent subtasks → parallel run.** Use `{ tasks: [...] }` (optionally `worktree: true`) when subtasks don't depend on each other — e.g. reviewing correctness, tests, and complexity at once.

### Guardrails

- A subagent is a **real child Pi session**, not a mock — it costs tokens and wall-clock time. Reserve delegation for work that genuinely benefits: multi-file scope, independent parallel work, or a second perspective. For a single known file or a one-line lookup, just do it inline.
- Keep the main context lean: let `scout` / `reviewer` absorb the large reads and bring back only their compressed result.
- Give each agent a clear, self-contained `task`; it does not see your conversation unless context is forked.

