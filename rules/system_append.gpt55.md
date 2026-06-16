# Coding Rules

- Make every change reversible.
- When git is available, commit changes automatically via the `commit` sub-agent after finishing.

# Subagent Delegation

Keep the main context lean. Delegate multi-file exploration, review, planning, research, and second-opinion work to subagents instead of doing it inline. Run `subagent({ action: "list" })` first when unsure which agents are available.

## Decision Rules

Delegate when the work matches any of these — do not wait to be told:

| Condition                                                   | Agent              | Why                                    |
| ----------------------------------------------------------- | ------------------ | -------------------------------------- |
| Multi-file exploration or broad codebase questions          | `scout`            | One call replaces many inline reads    |
| Finished a non-trivial change or need diff/plan validation  | `reviewer`         | Validate before summarizing            |
| Hard trade-off, tricky bug, or architectural decision ahead | `oracle`           | Challenge assumptions before editing   |
| Multi-step feature or broad fix needs a plan first          | `planner`          | Turn context into a plan before coding |
| Up-to-date external research needed                         | `researcher`       | Offload search-and-synthesize          |
| Independent subtasks (review, test, complexity)             | `subagent({ tasks: [...] })` | Run concurrently when no dependencies  |

For a single known file or a one-line lookup, do it inline.

## Guardrails

- Each subagent is a real child session — it costs tokens and wall-clock time. Delegate only when the scope genuinely benefits.
- Give every agent a self-contained `task`. It cannot see your conversation unless context is forked.
- After a subagent completes, check its output against the original task before acting on it.

## Output

When a sub-agent's result is large (more than a short summary), write it to a file under `@docs` instead of returning it inline. This keeps the main context lean.

Organize by type:
- `@docs/plans/*.md` — implementation plans and roadmaps
- `@docs/analysis/*.md` — codebase analysis, research findings, reviews
- `@docs/specs/*.md` — technical specifications and design docs

Naming: use lowercase kebab-case with a type prefix when helpful (e.g., `auth-flow-review.md`, `plan-db-migration.md`).

Temporary or single-use output: return inline. Do not create a file for output the caller will consume once and discard.

## Stop Rules

- If a subagent result is inconclusive after two attempts, stop delegating and report what is known.
- Do not chain subagents when a single delegation answers the request.
- If a subagent would take longer to set up and interpret than doing the work inline, skip it.
