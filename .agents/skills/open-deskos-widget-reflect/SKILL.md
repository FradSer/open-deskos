---
name: open-deskos-widget-reflect
description: >-
  Reflect on the current conversation and improve this project's open-deskos-widget skill.
  Use when asked to capture Widget/App development lessons, learn from user corrections,
  or update the Widget skill from session evidence; not for ordinary UI implementation.
---

# Reflect on Widget development

Improve `.agents/skills/open-deskos-widget/` from evidence in the current conversation. The deliverable is a focused skill-documentation change, not another product implementation or deployment.

## 1. Recover the evidence

Read the current target `SKILL.md` and relevant referenced documents before editing; preserve pre-existing changes. Use the conversation first. If earlier context was compacted, use the available session-history mechanism to recover the user's request, corrections, decisions, tool results, and unresolved blockers. If history cannot be recovered, name the missing evidence instead of inventing it.

Build a short evidence ledger:

| Evidence | Classification | Workflow failure | Proposed correction |
| --- | --- | --- | --- |
| User correction or observed result | Confirmed / hypothesis / unresolved | Missing, ignored, ambiguous, or conflicting instruction | Checkable process change |

Distinguish source inspection, runtime measurement, fixture tests, real-data acceptance, and subjective approval. Green tests do not override user dissatisfaction. A live process does not prove fresh data; an initialization failure does not reproduce a product bug. Never persist account data, credentials, machine-specific dumps, or private transcript content.

Completion: each proposed lesson has traceable evidence and an explicit confidence level. No product root cause is promoted from hypothesis to fact.

## 2. Extract a transferable principle

Explain why the previous process allowed the failure. Check whether the target skill already covers it:

- If the rule exists but was missed, improve its trigger, placement, or completion gate rather than repeating it.
- If instructions conflict, reconcile them against current product authority and explicit user constraints.
- If coverage is missing, add a reusable decision rule or verification gate.
- If the event is a one-off implementation detail, use it as reasoning evidence rather than a permanent instruction. Persist the underlying decision principle, not the incident narrative.

Preserve architecture boundaries and deliberate design decisions. Do not turn one Widget's font size, host address, process ID, recovery timing, or temporary workaround into a global default. User-approved neighboring Widgets are evidence for comparison, not permission to copy their contents blindly. A changed user requirement is not automatically a failure of the old implementation.

Abstract through three levels: observed event → decision or reasoning failure → transferable principle. Keep concrete evidence in the reflection report; the target skill should retain the principle, its applicability, and the evidence needed to judge completion.

Use the transfer test: would the rule improve decisions for a different component, a different symptom, and a different dependency? If it requires the original incident to make sense, abstract further or omit it. If it merely says “be careful” or “verify thoroughly,” make the decision boundary observable. Aim for the middle: actionable judgment without an incident-specific recipe.

Consolidate overlapping lessons and replace narrower guidance when a more general principle covers it. Reflection should improve the skill's explanatory power, not grow a catalog of past failures. Preserve explicit project constraints, safety requirements, and supported API contracts; abstraction is not permission to weaken them.

Completion: every edit changes a future decision, applies beyond the source incident, and adds no redundant rule.

## 3. Patch the right layer

Edit `.agents/skills/open-deskos-widget/SKILL.md` for universal rules or short conditional pointers. Put branch-specific reasoning frameworks and acceptance criteria in its `references/` tree. Add concrete recipes only for stable technical contracts that actually require them, not merely because a recent incident supplied details. Make new references reachable under the exact conditions that need them; keep each rule in one authoritative place.

Prefer a targeted patch over rewriting the skill. Keep its description focused on Widget/App design and development. Do not add reflection to its ordinary completion sequence: this skill runs when reflection is requested, not recursively after every change.

Respect the boundary with deployment and service-operation workflows. The Widget skill may specify the evidence those workflows must return; it cannot grant operational authorization. Editing instructions is not proof that a skill triggered, tests ran, or the reported product defect was fixed.

Scope: change the target skill and directly relevant skill evaluation documents only. Do not alter runtime code, restart services, deploy, commit, publish, create global copies, or add symlinks unless separately requested.

## 4. Validate the documentation change

Check frontmatter, local Markdown links, conditional reachability of new references, duplicated or contradictory rules, and consistency with project authority. Review the scoped diff while preserving unrelated changes.

For each proposed principle, walk three counterfactual cases:

1. The original incident: does the rule correct the reasoning failure?
2. A materially different component or failure: does the same rule guide a useful decision without copying the original fix?
3. A boundary case: does the rule avoid unnecessary changes, unsupported conclusions, or actions outside authorization?

Choose cases from the principle under review rather than preserving a fixed suite of past incidents. Reject guidance that only passes the original case. These are documentation walkthroughs, not claims of model evaluations. If executable skill evaluations are available and safe, run the affected ones and report their actual scope; otherwise explicitly state that behavioral evaluations were not run. Documentation-only work does not require unrelated runtime or device suites.

Completion: references resolve, each lesson is reachable, counterfactuals expose no instruction conflict, and validation limitations are explicit.

## 5. Report

Return a concise summary with:

- Transferable principles captured, with a brief explanation of the source evidence and the abstraction from it.
- Files changed and how the new rules affect future behavior.
- Validation performed, distinguishing document checks from executable evaluations.
- Unresolved product issues that remain unfixed.

Stop after the documentation delivery. Do not claim that recording a recovery gate repaired the data pipeline.
