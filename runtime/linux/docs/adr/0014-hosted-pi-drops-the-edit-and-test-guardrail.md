# Hosted Pi drops the edit-and-test-only guardrail

## Status

Accepted. Revised after an independent review: the guardrail is described as a system-prompt instruction rather than an enforced limit, the superseded-artifacts list is corrected and extended, the capability claim is scoped to the host's tool set, and the earlier answer this decision reversed is recorded.

## Context

The managed coding task existed to serve the voice path. Its request arrives as a spoken utterance that speech recognition transcribes at a distance, so `src/task-agent.mjs` appended a policy that forbade commits, pushes, installation, deployment, release activation, and product-service restarts, "even if the task text asks for it". That policy is pinned by `integrations/voice-agent/features/managed-tasks.feature` and restated in `integrations/voice-agent/docs/MANAGED_TASKS.md`.

The policy is a system-prompt instruction, not an enforced limit. The host builds the session with the default built-in tools, no tool allowlist, and only `appendSystemPrompt`, and its own documentation says the harness is "not a filesystem sandbox" and that the prohibitions are "agent instructions, not an OS-level command firewall". Removing it changes the likelihood of a mutation, not the capability to make one.

The operator first chose the opposite of this decision (keep the guardrail, including for the voice path) and then reversed it when they asked for full control. The earlier rationale (a request that arrives as a distant spoken utterance deserves a narrower capability) stopped being the deciding factor. The reversal is recorded here rather than presented as a single coherent decision: the earlier answer was accepted, then superseded on the operator's instruction.

## Decision

- A **Hosted Pi** has the desk's Pi host capability: every tool that host exposes, including commits, pushes, dependency installation, deployment, release activation, and service restarts. The host loads no extensions, skills, or prompt templates, so this is the host's tool set rather than everything a full Pi installation could do.
- The guardrail is removed, not made conditional on who started the session or on which machine attached. One capability, one profile.
- The rules that are not capability limits survive unchanged: truthful verification reporting, no replay of an interrupted task on restart, durable receipts, development-root admission, the host-wide concurrency cap, and no automatic retry of a mutation whose outcome is unknown.
- Hosted Pi replaces the managed coding task term and semantics; the reporting side of a Console and the voice path both reach the same capability.

## Consequences

- The voice path inherits the full capability. A mis-transcribed utterance can now commit, push, install, deploy, or restart a service on the desk or on a configured target. This is the accepted risk of this decision, not an oversight, and it is the reason the guardrail existed. The capability was already reachable: the prohibitions were system-prompt instructions over an unrestricted tool set, so what changes is that the instruction no longer discourages the action.
- Control Attribution covers Console-driven sessions only. A voice-started Hosted Pi has no Console, so nothing on the desk marks it as more or less authorized than work the operator asked for by voice.
- The policy text in `integrations/voice-agent/src/task-agent.mjs`, the "Managed tasks only edit and test" scenario in `integrations/voice-agent/features/managed-tasks.feature`, the assertions that pin that policy text in `integrations/voice-agent/tests/task-runner.test.mjs`, and `integrations/voice-agent/docs/MANAGED_TASKS.md`'s "Tasks are not interactive terminal windows and do not take over existing Pi sessions" statement are superseded and must be updated with the spec. The pinned scenario lists installation, commits, pushes, deployments, and service restarts while the policy text also prohibits release activation; the scenario and the instruction must be aligned when the instruction is removed.
- Removing the guardrail does not widen admission: a Hosted Pi still needs an operator-configured development root, Pi credentials, and the concurrency slot.
- Mitigations recorded and not adopted: an origin-scoped policy, a per-session operator confirmation from the Console, or a local confirmation on the desk.

## Considered options

- **Two profiles**: a restricted voice-originated task and a full-capability Console session. Rejected here because it preserves exactly the distinction the operator rejected. It remains the first mitigation to reach for if the accepted risk proves unacceptable.
- **Origin-scoped policy with explicit per-session escalation.** Not adopted for the same reason: the operator asked for one capability rather than a graded one.