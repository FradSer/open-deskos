# Task Status

> Generated from git commit history review.

## Completed (merged to main)

- [x] **接入 Gmail 到 Personal Agent**
  - `a16276e5` feat(link): integrate pluggable Gmail recommendations

- [x] **优化 Personal Agent 语音输入**
  - `b31d069e` feat(shell): update agent voice and keyboard input
  - `352adad7` feat(link): add voice and keyboard input design
  - PR #143 `codex/personal-agent-input`

- [x] **反思整个 overview 生成逻辑**
  - `1a9aed97` feat(shell): support all-source overview & facts
  - `a31991d2` fix(link): enforce 15-min overview cooldown
  - `1fb4e7a8` fix(link): throttle overview gen and retries
  - PR #145 `codex/overview-fifteen-minute-cadence`

- [x] **扩展 Nano C6 可插拔设备系统**
  - `a52bd9b8` feat(hw): add nanoc6 esp-now gateway firmware
  - `775d9aa1` docs(hw): document nanoc6 parser regression tests
  - `920fedee` feat(hw): add nanoc6 gateway and parser fix

## In Progress

- [ ] **打通真机 E2E 闭环**
  - Multiple E2E PRs merged: #131 (cm5-network-widget-e2e), #135 (split-agent-device-e2e), #136 (windows-local-apps-e2e)
  - CM5 deployment and acceptance tests passed
  - Remaining: Uncommitted fixes in `integrations/personal-agent/src/agent.mjs` and `main.mjs` (model binding and home selection serialization)

- [ ] **反思 Personal Agent 推荐逻辑**
  - Recommendation features landed: `b5c09dfb` (proactive), `dfe19342` (feedback), `4395919d` (learn from feedback)
  - Remaining: Active session fixing "Personal Agent has no new desk briefing" — uncommitted changes to recommendation selection logic in `agent.mjs`

- [ ] **等待任务完成后合并分支**
  - PRs #128–#147 all merged to main; no remote branches remain
  - Remaining: Current working tree has uncommitted changes that need to be committed and merged

## Not Started

- [ ] **Implement voice-created plugin compositions**
  - Architecture and planned BDD were recorded on 2026-11-06. Runtime implementation has not started in this work.
  - [ADR-0041](runtime/shell/docs/ARCHITECTURE.md#bdd-first-delivery-and-authorization) owns the stage order, contracts, and authorization gates.
  - [Planned scenarios](integrations/service-runtime/features/generated-plugins.feature) need failing public-interface tests before each implementation stage.
  - Keep the existing NAS Docker OpenD and current poller deployment unchanged.
  - Preserve the separate `cm5-linux-sandbox` worktree's unfinished trusted-Python hardening. It does not establish sandbox enforcement.

- [ ] **设计 Personal Agent 虚拟机接入方案**
  - No commits found related to VM/sandbox/container isolation
  - Likely still in design phase

- [ ] **Add a Widget expansion animation**
  - Recorded 2026-11-05. Owner request: add an animation for expanding a Widget into its App.
  - Status: TODO only. Do not implement. Define Given/When/Then scenarios and a failing test before any behavior change.

## Proposed follow-ups from the dsh-superagent comparison

Added 2026-11-03. Status: proposed. This section authorizes no code change.
New entries use English. Earlier sections keep their original text.
Read the [comparison note](integrations/personal-agent/docs/DSH_SUPERAGENT_COMPARISON.md) for evidence and citations.
This section records design work. It does not come from commit history.
The basis is document reading and a source spot-check. No runtime was built or run.
Relative paths in this section start at `integrations/personal-agent/`.
Start with Priority 1 if only one item is funded.
The working tree has in-flight proactive work owned by another session.
Resolve ownership before Priority 1 or Priority 3 starts.

### Priority 1: share one admission and receipt mechanism

- [ ] Extract a shared `Reservation` / `Receipt` module.
  - Keep all socket frames, tool names, and private file formats unchanged.
  - Let each domain declare whether its action can safely replay.
  - Keep the existing per-domain stores as adapters.
  - Basis: `src/proactive-state.mjs:60`, `src/task-service.mjs:44`, `src/service.mjs:237`, `docs/CONTRACT.md:365-371`, `docs/INTENTS.md:49-54`, `docs/AGENT_CATALOG.md:140`.
  - Comparison: the upstream prototype uses one Effects queue and one Outbox. See the note, "Durability and recovery".
  - Acceptance: each migrated domain passes its existing feature tests. No status frame or tool contract changes.
  - Dependency: `features/proactive-suggestions.feature` and `src/proactive-generation.mjs` are in flight.

### Priority 2: record admitted work across turns

- [ ] Add an immutable record for each admitted work item.
  - Store the target, project, original intent, admitting turn, configuration version, and expiry condition.
  - Let later turns reference that record. Revalidate the version before resume.
  - Do not add a Mandate, Policy, admission table, or cross-Source identity mapping.
  - Basis: `docs/CONTRACT.md:355-362`, `docs/CONTRACT.md:425-435`, `features/intent-routing.feature`.
  - Acceptance: a continuation turn resolves the same record without a second intent guess. A stale version refuses resume.

### Priority 3: add an `observe` delivery mode

- [ ] Generate, judge, and record a proposal without presenting it.
  - Do not consume an attention budget in this mode.
  - Keep `silent` unchanged. Silent waits for an owner query. See `docs/CONTRACT.md:729` and `docs/CONTRACT.md:734`.
  - Run a new goal in `observe` before switching it to `immediate`.
  - Basis: the upstream default records "would accept". See the note, "Proactivity".
  - Acceptance: a configured goal writes receipts and publishes no proposal. `pnpm test:proactive:evaluate` covers the new mode.
  - Dependency: the same in-flight proactive work as Priority 1.

### Priority 4: default `autoLearn` to false

- [ ] Change the default in `src/agent-plugins/selection.mjs:11`.
  - Keep the `completion` plugin and `experience` retrieval.
  - Enable automatic learning only for task families with independent grading.
  - Basis: `docs/PERSONAL_AGENT_IMPLEMENTATION.md:168` reports `not_established`. `docs/AGENT_PLUGINS.md:57` already skips receipt-free conversation.
  - Acceptance: a fresh configuration writes no lesson. An explicit `autoLearn: true` still writes one.

### Priority 5: version non-authorizing behaviour text

- [ ] Move advice wording, priority rules, and silence rules into versioned text.
  - Keep all `ODK_*` bounds, `docs/CONTRACT.md:714-735`, tool descriptions, notices, and cards in code.
  - Show a diff against the shipped default after an upgrade.
  - Basis: upstream prompt versions. See the note, "Prompts, settings, and authority".
  - Acceptance: an operator changes quietness wording without a code change. The safety bounds stay read-only.

### Guardrails

Do not add a Mandate, Policy, admission table, or cross-Source identity mapping.
Do not merge the 22 intent rows into four routing decisions. See `docs/CONTRACT.md:318-340`.
Do not copy `danger-full-access`, unbounded storage, or the missing long-term memory.
Do not split `CONTRACT.md` into parallel documents.
Do not deploy, activate, or run device acceptance for these items.

### Before each item

Write Given/When/Then scenarios in the applicable feature file before the behavior change.
Reproduce the change with a failing regression test.
Affected feature files: `features/proactive-suggestions.feature`, `features/intent-routing.feature`, `features/agent-plugins.feature`, `features/agent-tasks.feature`.
Run `node --test --test-timeout=120000 --test-concurrency=4 tests/*.test.mjs` in `integrations/personal-agent/`.
Run `pnpm typecheck` in `integrations/personal-agent/`.
Run the affected Shell checks.
Update `CONTRACT.md` and `UNIFIED_ARCHITECTURE.md` when a contract changes.
