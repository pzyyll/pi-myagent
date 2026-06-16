---
name: gpt-55-prompt-optimizer
description: Optimize, rewrite, review, or diagnose prompts for GPT-5.5 based on OpenAI prompt guidance. Use when the user asks to improve a prompt, system prompt, developer instruction, agent prompt, tool-use prompt, coding-agent prompt, research/citation prompt, creative drafting prompt, frontend-generation prompt, or structured-output contract for GPT-5.5; also use for prompt migration from older GPT models to GPT-5.5 and for creating reusable prompt templates.
---

# GPT-5.5 Prompt Optimizer

Use this skill to turn a user's draft prompt into a clearer GPT-5.5 prompt with explicit outcomes, success criteria, constraints, evidence rules, validation, and stop conditions. Base the optimization on the official OpenAI prompt guidance at `https://developers.openai.com/api/docs/guides/prompt-guidance`.

Read `references/gpt-55-guidance.md` when the task needs detailed rewrite patterns, review checklists, or domain-specific prompt blocks. For small edits, the workflow below is enough.

## Workflow

1. Identify the intended workflow:
   - chat assistant
   - coding agent
   - research or citation-heavy answer
   - creative drafting
   - frontend or visual artifact generation
   - tool-heavy or long-running agent
   - implementation planning
   - structured output
2. Extract the user's actual requirements from the draft prompt. Preserve business rules, safety requirements, output fields, tone, and domain constraints.
3. Replace step-by-step micromanagement with outcome-first instructions unless those steps are true invariants.
4. Add explicit success criteria and stop rules. Define when to answer, ask for missing information, retry, fallback, abstain, or stop.
5. Add evidence and grounding rules when the prompt asks for factual claims, recommendations, current information, citations, or retrieval.
6. Add validation rules when the model can check work with tests, rendering, calculations, schemas, tools, or source inspection.
7. For tool-heavy or long-running prompts, add short user-visible preamble behavior and make final-answer boundaries clear.
8. Return the optimized prompt and a concise change summary. Do not bury the improved prompt under long explanation.

## Rewrite Rules

- Prefer destination over itinerary: define the target outcome and completion criteria, then let GPT-5.5 choose the path.
- Use `must`, `always`, `never`, and `only` only for true invariants such as safety, required output fields, irreversible actions, or forbidden behavior.
- Use decision rules for judgment calls: when to search, when to ask a question, when to use a tool, and when to continue.
- Keep prompt sections short. Add detail only where it changes model behavior.
- Separate personality from task requirements. Tone should shape delivery, not compensate for an unclear goal.
- Make unsupported specifics impossible: tell the model which claims need evidence and what to do when evidence is missing.
- Ask for concrete validation when validation is possible.
- Avoid asking for hidden reasoning. Ask for plans, assumptions, checks, and concise rationales when they are useful to the user.

## Default Structure

Use this structure for complex prompts:

```text
Role: [1-2 sentences defining the model's function, context, and job]

# Personality
[Tone, demeanor, and collaboration style]

# Goal
[User-visible outcome]

# Success Criteria
[What must be true before the final answer]

# Constraints
[Policy, safety, business, evidence, and side-effect limits]

# Tools And Validation
[When to use tools; what checks to run; what to do if validation is unavailable]

# Output
[Sections, length, format, and tone]

# Stop Rules
[When to retry, fallback, abstain, ask, or stop]
```

## Output Format

When optimizing a prompt, respond with:

````markdown
**Optimized Prompt**

```text
[rewritten prompt]
```

**What Changed**
- [highest-impact changes only]
````

If the user's prompt is underspecified, make reasonable assumptions and list them after the optimized prompt. Ask a clarifying question only when a missing answer would materially change the prompt.
