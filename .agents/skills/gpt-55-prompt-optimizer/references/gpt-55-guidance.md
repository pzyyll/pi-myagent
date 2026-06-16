# GPT-5.5 Prompt Guidance Reference

Source: OpenAI API prompt guidance, `https://developers.openai.com/api/docs/guides/prompt-guidance`, fetched June 17, 2026.

## Core Patterns

### Outcome-first prompting

GPT-5.5 works best when prompts define the target outcome, success criteria, constraints, and available context, then let the model choose the path. Replace brittle ordered procedures with completion criteria unless the order is genuinely required.

Use:

```text
Resolve the user's request end to end.
Success means:
- the required decision or artifact is complete
- required actions are performed before the final answer
- missing evidence or permissions are reported as blockers
- the final answer follows the requested format
```

Avoid long chains like "first do A, then B, then compare every field..." unless each step is mandatory.

### Stop rules

Add stopping rules for search, tool loops, retries, clarification, and final answers.

```text
Resolve the request in the fewest useful tool loops, but do not let loop minimization outrank correctness, required evidence, calculations, validation, or citation requirements.
```

### Preambles

For multi-step, tool-heavy, or long-running tasks, ask for a short user-visible update before tool calls.

```text
Before any tool calls for a multi-step task, send a short user-visible update that acknowledges the request and states the first step. Keep it to one or two sentences.
```

### Evidence and citations

For grounded answers, make citation behavior part of the prompt. Define what needs support, what counts as enough evidence, and how to behave when evidence is missing.

```text
For factual claims, use retrieved or provided evidence. Cite concrete product, customer, metric, roadmap, date, capability, legal, medical, financial, and competitive claims. If evidence is missing, say what is missing; do not turn absence of evidence into a factual denial.
```

Add a retrieval budget:

```text
Start with one broad search using short, discriminative keywords. If the top results contain enough citable support for the core request, answer from those results instead of searching again.
```

### Creative drafting guardrails

For slides, launch copy, customer summaries, leadership blurbs, outbound copy, talk tracks, and narrative framing, separate source-backed claims from creative language.

```text
Use provided or retrieved facts for concrete product, customer, metric, roadmap, date, capability, and competitive claims. Do not invent names, first-party data, metrics, roadmap status, customer outcomes, or product capabilities. If support is thin, write useful generic copy with placeholders or clearly labeled assumptions.
```

### Validation

For coding agents:

```text
After making changes, run the most relevant validation available:
- targeted tests for changed behavior
- type checks or lint checks when applicable
- build checks for affected packages
- a minimal smoke test when full validation is too expensive
If validation cannot be run, explain why and describe the next best check.
```

For visual artifacts:

```text
Render the artifact before finalizing. Inspect the rendered output for layout, clipping, spacing, missing content, and visual consistency. Revise until the rendered output matches the requirements.
```

For implementation plans:

```text
Include requirements coverage, named resources/files/APIs/systems, relevant state transitions or data flow, validation commands, failure behavior, privacy and security considerations, and open questions that materially affect implementation.
```

### Phase handling

For Responses workflows that replay assistant items manually, preserve assistant `phase` values exactly. Use `phase: "commentary"` for intermediate user-visible updates, `phase: "final_answer"` for completed answers, and do not add phase to user messages.

## Review Checklist

- Does the prompt define the role and goal in one or two direct sentences?
- Are success criteria observable?
- Are hard rules limited to true invariants?
- Are judgment calls expressed as decision rules?
- Does the output contract specify sections, format, length, and tone?
- Does the prompt say when to ask for clarification?
- Does it include evidence rules for factual claims?
- Does it include validation rules when checks are possible?
- Does it include stop rules for search, retries, tool loops, and finalization?
- For long-running work, does it ask for concise user-visible updates?
- For manually replayed Responses messages, does it preserve `phase`?

## Common Fixes

- Vague goal -> add a concrete deliverable and success criteria.
- Overly procedural prompt -> replace with outcome and constraints.
- Excessive `always`/`never` -> keep only safety and output-contract invariants.
- Missing evidence policy -> add citation and missing-evidence behavior.
- Hallucination-prone drafting -> require placeholders or labeled assumptions.
- Coding prompt without tests -> add validation command expectations.
- Visual prompt without inspection -> require rendering and revision.
- Tool prompt with silent long wait -> add short preamble/user update behavior.
- Long prompt with mixed concerns -> split into Role, Goal, Success Criteria, Constraints, Tools And Validation, Output, Stop Rules.
