---
name: typesafe-ai
license: MIT
description: >
  Build AI-powered software with TypeSafe: small units of AI intelligence you
  can use like programming primitives. Its System One models, including Jev,
  turn natural language and application state into typed judgments and
  probabilities that code can combine. Use when a feature needs programmable
  common sense, when brainstorming what AI could make possible in an app, or
  when an LLM prompt-and-parse step could become a structured decision.
  Applications include routing, ranking, extraction, verification, and
  interactive experiences; these are starting points, not the limits.
  Read live docs and cookbooks to find useful patterns and discover new combinations.
---
# Build with TypeSafe

Use typed System One judgments where semantic understanding helps; keep exact rules, calculations, lookup and execution in code.
Preserve the user's stack and scope.
Jev returns judgments/probabilities, not generated explanations.

## Read current contracts

Start with the [live documentation index](https://docs.typesafe.ai/llms.txt), then read the relevant API/SDK, question guidance and nearest cookbook.
Follow index paths; Markdown pages append `.md`, relative links resolve against `https://docs.typesafe.ai`.
If Markdown fails, try normal pages; if live access is unavailable, use installed types/local docs, report the limitation and do not invent current API details.

| Task | Start here; follow the relevant details |
| --- | --- |
| Understand the programming model | [System One](https://docs.typesafe.ai/concepts/system-one.md), [building guide](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md) |
| Explore what to build | [Use-case map](https://docs.typesafe.ai/concepts/use-case-map.md), then relevant cookbooks from the index |
| Prepare inputs and questions | [State](https://docs.typesafe.ai/concepts/state.md), [primitives](https://docs.typesafe.ai/primitives.md), then the chosen primitive's page |
| Decide how to handle uncertainty | [Confidence](https://docs.typesafe.ai/confidence.md) |
| Write API code | [HTTP API](https://docs.typesafe.ai/api.md), [Python SDK](https://docs.typesafe.ai/sdk/python.md), or [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript.md) |
| Update an older integration | [Migration guide](https://docs.typesafe.ai/migrating-to-v1.md) and the installed SDK's current reference |

## Choose the shape

Work backward from the requested observable behavior.
For a concrete request, build the relevant pattern; brainstorming is optional.
Combine patterns where useful:

| Pattern | Current examples |
| --- | --- |
| Route with typed arguments | [Function dispatch](https://docs.typesafe.ai/cookbooks/function_calling.md), [fan-out](https://docs.typesafe.ai/patterns/fan-out.md) |
| Select known candidates/source spans | [Value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook.md), [structure recovery](https://docs.typesafe.ai/cookbooks/autoformat.md) |
| Retrieve and judge relevance | [Reranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md), [hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification.md) |
| Reuse judged dimensions as data | [Composite scoring](https://docs.typesafe.ai/patterns/composite-scoring.md), [feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery.md) |
| Verify and escalate uncertainty | [Citation checks](https://docs.typesafe.ai/cookbooks/citation_check.md), [extraction cascades](https://docs.typesafe.ai/cookbooks/sde_cascade.md) |

Changing-state workflows distinguish observed facts from inference and recheck freshness before using a judgment.

## Design judgments

| Need | Primitive | Important distinction |
| --- | --- | --- |
| One of a defined set | [Choice](https://docs.typesafe.ai/primitives/choice.md) | Picks one option; its distribution compares competing options |
| Whether a condition holds | [Noul](https://docs.typesafe.ai/primitives/noul.md) | Probability of yes; no separate confidence; use one per label when several may apply |
| Degree along a described dimension | [Score](https://docs.typesafe.ai/primitives/score.md) | Probability-weighted position on ordered levels; use comparable per-item Scores for graded ranking |

- Supply relevant state: source, identities, relationships, policies and current facts. Named JSON fields clarify multi-part state. Instructions state the judgment; criteria define complete possible answers. Question IDs are not model context. Reference nested state explicitly.
- One coherent judgment per question; split independent dimensions without losing their relationship. Atomic does not mean a one-sentence/literal-fact restriction. Structured criteria/examples are useful when needed.
- Score levels describe concrete situations independently. Include no-match/presence outcomes where appropriate; source selection cannot recover an omitted candidate.

## Compose and verify

- Batch independent questions over shared state; they cannot see sibling answers. State speculative premises explicitly and consume only applicable branches. Use another request when earlier output is needed to fetch/construct state. Measure real cost, latency and budgets.
- Choice/Score confidence describes distribution concentration, not correctness or permission. Noul near 0.5 means competing yes/no probabilities, not medium intensity. Evaluate thresholds on user data and consequences; unused-branch uncertainty need not block the workflow.
- Weighted scores suit compensating preferences; any-serious-violation policy needs separate conditions. Reweighting unchanged evidence/questions need not rerun inference.
- Typed output guarantees shape, not truth. Test representative application outcomes and distinguish missing evidence, model, composition/code and service errors. Cookbook thresholds/demo results are examples, not universal policy.
- Inspect failing state, questions, candidates, answers and observed outcome. Keep API credentials server-side.
