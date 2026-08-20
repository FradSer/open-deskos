# Retrospective 2026-06-13 — Feasibility / risk-asymmetry gap in design+plan checklists

**Scope:** `docs/plans/2026-06-12-mvp-firmware-client-design/` (design) + `docs/plans/2026-06-13-mvp-firmware-client-plan/` (plan)
**Trigger:** Human design review (反思) of a design that passed `design-v1` 5/5 in Round 2 yet carried four substantive feasibility/risk issues with no covering checklist item.
**Run type:** First retrospective on this project (no `evolution-log.jsonl`, no `plans-completed.jsonl` prior to this run).

## Pre-Checks

- **Pre-Check A (INSUFFICIENT-POST-PLAN):** `plans-completed.jsonl` absent → skipped silently. The plan is unexecuted (repo is pure-documentation), so no post-plan diff signal exists (Phase 5a yields nothing this run).
- **Pre-Check B (memory priors):** no calibration-relevant memory hooks in context → no priors to carry into Phase 3/4.
- **Phase 0:** `design-v1` + `plan-v1` present; `code-v1` absent but out of scope (no code evaluation data; user scoped to design+plan). Not seeded this run.

## Phase 1–2: Data & Pattern Analysis

| Source | Result |
|---|---|
| Design Round 1 | REWORK — 1 FAIL (REQ-TRACE-01, resolved Round 2) |
| Design Round 2 | PASS 5/5 |
| Plan evaluations | none on disk (plan not formally evaluated) |
| evolution-log history | none (first run) |

**Failure frequency:** n/a (single design, already resolved its one historical FAIL).

**Variety gap (Phase 2.4 — the load-bearing finding):** Round 2 PASS 5/5, yet a human review surfaced four issues the checklist cannot see. `design-v1`/`plan-v1` items are all **document self-consistency** checks (REQ traceability, layer-direction, concrete Givens, risk-has-action, DAG acyclicity, ref resolution, test pairing). None evaluates external feasibility. The four missed patterns:

1. **Scope minimality not challenged.** The MVP bundles ≥3 independently-shippable clusters (voice/ASR pipeline, ESP-NOW mesh, multi-OS client) with no argument for why they cannot be later increments. No item asks "is this minimum?" → new **FEAS-SCOPE-01**.
2. **Risk-ordering asymmetry.** esp-hosted (named "最大未知数") is correctly front-loaded to a first-week retest (G-4), but the custom ICNA3312 MIPI-DSI panel — an equally hard, equally unvalidated bring-up — is asserted "机械、硬件已验证" (`_index.md:170`) and postponed to task-020. Same-class unknown, opposite treatment, no validating evidence. No item catches the asymmetry → new **RISK-FRONT-01** (design) + **SPIKE-FRONT-01** (plan).
3. **Make-or-break gate buried.** The project's defining risk — the #184/#167 esp-hosted retest (G-4) — lives as `Step 4` inside `task-016-infra-hosted-impl`, a GREEN task whose success criteria assume it passed, with no pivot branch. No item catches a buried gate → new **RISK-GATE-01** (plan).
4. **Premature abstraction inconsistent with the design's own stance.** The design rejects protobuf citing "2 message families = not worth an abstraction layer" (`architecture.md:113`) but adopts a full `asr_provider_port` + two `.c` implementations for two *unproven* ASR providers (讯飞/Deepgram). Same low-N, opposite call, no distinguishing justification. No item catches the inconsistency → new **ABS-01** (design).

**Never-failing items / REMOVE:** none eligible — only 2 evaluation reports exist; REMOVE requires 3+ reports per item. No monotonic-growth concern flagged this run (first growth event).

## Phase 3–4: Evolution Proposals (all applied)

Evidence is 1-plan + human variety-gap review — below the 2-plan auto-ADD threshold, but the same signal class Phase 5a graduates at 1-plan, applied per explicit maintainer direction. All items are written to generalize beyond this project. Within EVO-6 (≤3 proposals/mode).

| # | Mode | Type | Item | Rationale (evidence) |
|---|---|---|---|---|
| 1 | design | ADD | **FEAS-SCOPE-01** | MVP bundles voice + mesh + multi-OS client, no split rationale (`_index.md` milestones M-1..M-7, YAGNI fence `:172-174`). |
| 2 | design | ADD | **RISK-FRONT-01** | esp-hosted front-loaded (G-4, `_index.md:131`) vs DSI panel asserted known (`_index.md:170`) — risk-ordering asymmetry, no validating task for the panel. |
| 3 | design | ADD | **ABS-01** | protobuf rejected for low N (`architecture.md:113`) while `asr_provider_port` adopted for 2 unproven impls (`architecture.md:86,139`), no distinguishing justification. |
| 4 | plan | ADD | **RISK-GATE-01** | G-4 #184/#167 retest buried as `task-016-infra-hosted-impl` Step 4, no pivot branch. |
| 5 | plan | ADD | **SPIKE-FRONT-01** | DSI panel/touch bring-up (design-named hardware) has no front-loaded validating task; task-020 is full-impl with the unknown unresolved upstream. |

**Self-rejected:** none.
**Deferred (EVO-6 / future runs):** none — 3 design + 2 plan is within the per-mode cap.

Checklists updated: `design-v1` → `design-v2` (3 ADDs), `plan-v1` → `plan-v2` (2 ADDs).

## Phase 5: Harness Health

- **5a (post-plan correction mining):** no signal — plan unexecuted, no post-plan commits to classify.
- **5b (usage-driven notes):** This is the project's first checklist evolution; the v1 checklists were generic auto-seeds + one round-1 patch. The four gaps above all stem from v1 measuring **internal document consistency** but not **external feasibility**. Future design reviews should weight the new inferential items, which require reading the design against reality (hardware difficulty, scope minimality) rather than grepping the document against itself.

## Pre-Edit Snapshot (rollback)

`design-v1.md` and `plan-v1.md` are preserved unchanged. To roll back: delete `design-v2.md` / `plan-v2.md`; the evaluators fall back to the highest remaining `{mode}-v{N}.md`. Remove the corresponding `item_added` rows from `evolution-log.jsonl` to keep the re-proposal guard consistent.

## Summary

- **Proposals approved:** 5 (3 design, 2 plan). **Rejected:** 0.
- **Checklists:** design v1→v2, plan v1→v2.
- **Companion action (per maintainer):** the design and plan documents were amended in the same change to resolve all four findings — M-0 hardware-spike milestone added, G-4 extracted to a standalone decision-gate task, ASR provider scope narrowed, and (new maintainer directive) the client scoped to macOS-only with Windows/Linux deferred to a later increment. See the design/plan amendment sections.
