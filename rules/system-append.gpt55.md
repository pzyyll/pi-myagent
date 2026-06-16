# Coding Rules

- Keep changes small, scoped, and easy to review.
- Avoid destructive or irreversible operations unless the user explicitly requests them.
- Do not commit automatically unless the user asks for a commit. When committing, use the `commit` sub-agent if available.

# Subagent Delegation

Use subagents when they materially improve speed, coverage, or confidence, especially for broad exploration, independent review, planning, research, or second opinions.

For a single known file, simple lookup, or narrow edit, work inline. If the available subagents are unknown and delegation would be useful, run `subagent({ action: "list" })` first.

## Decision Rules

Delegate when the benefit outweighs the setup and review cost:

| Condition                                                   | Agent                        | Use when                                                     |
| ----------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------ |
| Multi-file exploration or broad codebase questions          | `scout`                      | Inline reading would require many files or risk missing context |
| Finished a non-trivial change or need diff/plan validation  | `reviewer`                   | A second pass can catch regressions before the final response |
| Hard trade-off, tricky bug, or architectural decision ahead | `oracle`                     | Assumptions need challenge before editing                    |
| Multi-step feature or broad fix needs a plan first          | `planner`                    | A plan would reduce rework                                   |
| Up-to-date external research needed                         | `researcher`                 | The answer depends on current information                    |
| Independent subtasks (review, test, complexity)             | `subagent({ tasks: [...] })` | Tasks have no dependencies and can run concurrently          |

## Guardrails

- Each subagent is a real child session — it costs tokens and wall-clock time. Delegate only when the scope genuinely benefits.
- Give every agent a self-contained `task`. It cannot see your conversation unless context is forked.
- After a subagent completes, check its output against the original task before acting on it.
- Do not chain subagents when a single delegation answers the request.

## Output

Return short subagent results inline. If a result is large and the repository has a suitable writable docs directory, write durable analysis there instead of returning it inline.

Organize by type:

- `docs/plans/*.md` — implementation plans and roadmaps
- `docs/analysis/*.md` — codebase analysis, research findings, reviews
- `docs/specs/*.md` — technical specifications and design docs
- `docs/contexts/*.md` - any large output context files that are inconvenient to categorize

Naming: use lowercase kebab-case with a type prefix when helpful (e.g., `auth-flow-review.md`, `plan-db-migration.md`).

Temporary or single-use output: return inline. Do not create a file for output the caller will consume once and discard.

## Stop Rules

- If a subagent result is inconclusive after two attempts, stop delegating and report what is known.
- If a subagent would take longer to set up and interpret than doing the work inline, skip it.
