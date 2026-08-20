# Retrospective 2026-07-11 — host-vs-target divergence + managed-component patches + sub-agent misreporting

**Scope:** `docs/plans/2026-07-10-open-deskos-one-prompt-app-plan/` (16 tasks, 4 batches) — the P-2 "one-prompt Lua app creation + App Center persistence" slice.
**Trigger:** Post-completion analysis of the execution + on-target flashing. All 16 tasks PASS (ledger 16/16), but the on-target bring-up surfaced three recurring defect classes the checklist cannot catch.
**Run type:** Second project retrospective. Prior: `retro-2026-06-13-feasibility-gap.md` (design/plan v1→v2). This run evaluates the **code** checklist (`code-v1.md`) for the first time — the prior retro predated any executed plan.

## Pre-Checks

- **Pre-Check A (INSUFFICIENT-POST-PLAN):** one plan completed (`plans-completed.jsonl` detection is hook-driven; the plan landed commit `c6ea2ec` + follow-on hardware commits `c9d2875`/`40a7ca7`/`4598eef`/`f30ac4e`). The post-plan commits are real but were hardware-bring-up fixes outside the formal executing-plans loop — Phase 5a mines the *plan's own* commit (`c6ea2ec`) for corrections; the hardware commits are this retro's primary signal.
- **Pre-Check B (memory priors):** `pitfall_slice-plan-reflection-gaps.md` (writing-plans Phase 4 FAILs) + `open-deskos-firmware-host-vs-idf-build.md` (host-vs-target traps) are in context — both directly feed this retro's findings.

## Phase 1–2: Data & Pattern Analysis

| Source | Result |
|---|---|
| Batch 1 eval | PASS (first pass) |
| Batch 2 eval | PASS (first pass) — flagged `string.dump` nil-`__call` bridge as acceptable-with-wart |
| Batch 3 eval | REWORK → PASS (1 round; blocking 64KB probe-ceiling defect) |
| Batch 4 eval | PASS (first pass) — noted stale-image risk, HIL honest-SKIP correct |
| evolution-log history | 1 prior retro (2026-06-13, design/plan mode) |

**Failure frequency:** Batch 3 = 1 REWORK round (the 64KB `FILE_PROBE_BUF_LEN` ceiling). Batches 1/2/4 first-pass PASS. Low failure rate — but the on-target flashing (post-eval, outside the checklist's scope) surfaced three defect classes the checklist rated as PASS.

### The three defect classes the code checklist cannot see (Phase 2.4 — load-bearing)

These all passed `code-v1.md` (host suite green + `idf.py build` green) yet broke on real hardware:

1. **Host test suite green ≠ firmware boots.** The host harness (`tests/host/`, plain CMake + Unity) globs all `odk_*/src` into one library with relaxed flags and no IDF component boundaries. `idf.py build` compiles each component separately with `-Werror=format-truncation` and requires cross-component REQUIRES declarations. Three IDF-only failure classes that host tests never catch:
   - Missing cross-component `REQUIRES` (`odk_svc_llm` includes `odk_err.h` from `odk_domain` but didn't REQUIRES it → IDF build fails; host glob hides it).
   - `-Werror=format-truncation` on `snprintf` into fixed buffers (host doesn't apply this flag; path-concat snprintf into `char[N]` from `char[N]` triggers it on-target).
   - C block-comment `*/` inside a glob-pattern comment (`odk_*/src` closes the comment early → phantom syntax error). Host never hits it because the glob source is compiled via a different path.

2. **Managed-component source patches are non-durable.** To unblock the no-C6 bootloop, the esp_hosted constructor (`port_esp_hosted_host_init.c`) was patched to a no-op. This file lives under `managed_components/` — `idf.py build` preserves it, but any `rm dependencies.lock` / re-fetch clobbers the patch silently. The patch is load-bearing (without it, `esp_hosted_reconfigure` blocks at constructor time before `app_main`), and its fragility is invisible to any checklist item.

3. **Sub-agent "test is buggy" claims were hallucinated twice, real once.** Across 16 tasks, three sub-agents claimed a test had a bug:
   - 003-impl: claimed manifest fixtures were 63-hex-char (they were 64) — **hallucinated**, the impl code was correct; the claim nearly caused a correct test to be broken.
   - 008-impl: claimed scenario-4's `any_mutating_op` assertion was unsatisfiable — **real** (gen writes staging before installer, no reset between; the assertion scanned the whole log). Fixed in the test, not the impl.
   - The coordinator (batch 1) repeatedly went idle without returning structured results, and the esp_hosted bootloop was mis-attributed to `wifi_manager_init` for several iterations before the real cause (a `__attribute__((constructor))` in the managed component) was found.
   The code checklist has no item that catches a sub-agent asserting "test is buggy" without having run it — the receiving-code-review skill requires verification, but the checklist doesn't grade whether verification happened.

### Patterns from the pitfall memory + preflight (prior retro's deferred items, now confirmed)

The writing-plans Phase 4 retro (`pitfall_slice-plan-reflection-gaps.md`) already flagged:
- PLAN-COV-01's `grep ^Scenario:` never matches indented gherkin (vacuous pass) — **confirmed still broken** in this run's plan-eval (the PLAN-COV-01 check had to use a corrected indentation-tolerant grep).
- DEP-02's grep over-matches cross-plan prose references — **confirmed** (06-13 task-013/025 referenced in prose were flagged as unresolved deps).
- Missing items: DEP-03 (Consumes→depends-on ancestor), GRAPH-01 (dep graph vs YAML edge consistency), `type: integration` TEST-01 rule.

These are **plan-checklist** items (plan-v2.md), not code items. They're carried forward here as a batch — this retro's scope is the code checklist, but the plan items were deferred from the prior retro and are now ready (the plan-v2 items were proposed but the prior retro ran before the plan was executed, so they weren't validated against a real execution).

## Phase 3–4: Evolution Proposals

Evidence: 1 plan, 4 batch evals, on-target flashing log (5+ boot captures), 2 sub-agent misreport incidents. The host-vs-target and managed-patch patterns each appeared in a single plan but are structurally recurring (any embedded firmware plan with a host-sim + on-target split will hit them). Applied per explicit maintainer direction (the on-target flashing is the proof these aren't theoretical).

| # | Mode | Type | Item | Rationale (evidence) |
|---|---|---|---|---|
| 1 | code | ADD | **CODE-HOST-TARGET-01** | Host test suite green + `idf.py build` green ≠ firmware boots on hardware. The host harness uses a single globbed library with relaxed flags; the target build uses per-component REQUIRES + `-Werror=format-truncation` + separate compilation units. A batch that passes all host checks can still fail to boot on-target (missing REQUIRES, format-truncation aborts, comment-`*/` syntax errors). Check: if the plan has a host-sim AND an on-target build, the evaluator must confirm (a) every odk_* component's CMakeLists REQUIRES matches its cross-component `#include`s (host glob hides this), (b) no `snprintf` into a `char[N]` from a `char[N]` source without a return-value check or larger dest, (c) no `*/` sequence inside C comments. |
| 2 | code | ADD | **CODE-PATCH-DURABILITY-01** | A patch to a `managed_components/` source file (e.g. an esp_hosted constructor no-op to unblock a no-co-processor boot) is load-bearing but non-durable — `rm dependencies.lock` / re-fetch clobbers it silently. Check: if the execution touched any file under `managed_components/` (grep `git status` / UPSTREAM.md), the patch must be (a) recorded in UPSTREAM.md with a re-apply note, AND (b) ideally re-homed as a fork-local overlay or a Kconfig guard so a re-fetch doesn't silently regress the boot. A patch that lives only in managed_components with no re-apply documentation is a latent boot-failure. |
| 3 | code | ADD | **CODE-SUBAGENT-VERIFY-01** | Sub-agents claiming "the test is buggy" without having run it is a recurring false-positive source (this plan: 1 hallucinated 63-char hash, 1 real unsatisfiable assertion — indistinguishable without independent verification). The receiving-code-review skill constrains the implementer side, but the code checklist doesn't grade it. Check: any REWORK item whose stated cause is "test assertion is wrong/unsatisfiable" must carry, in the rework report, the actual command+output that was run to confirm the assertion fails for the stated reason (not "it should fail because..."). A "test is buggy" claim with no run evidence is treated as unverified → re-dispatch with a "run the test first" instruction, not implemented. |

**Self-rejected:**
- A generic "no `string.dump` nil-`__call` bridge" item — too specific to this plan's Lua sandbox; the bridge was judged acceptable by the evaluator. The lesson (over-constrained joint assertions force hacky bridges) is real but doesn't generalize to a binary checklist item. Deferred to a best-practices note, not a PASS/FAIL gate.
- A "coordinator must return structured results" item — this is an orchestrator-discipline issue (the main agent's job to enforce), not a code-quality property of the produced artifacts. The code checklist grades artifacts, not the orchestration process.

**Deferred (EVO-6 cap):** 3 code items this run (within the ≤3 cap). The plan-checklist items deferred from the prior retro (PLAN-COV-01 grep fix, DEP-02 scope fix, DEP-03, GRAPH-01, `type: integration`) are **plan-mode** items — they'll be proposed in the next plan-mode retro (this run is code-mode). Recorded here so they're not forgotten.

## Phase 5: Harness Health

- **5a (post-plan correction mining):** The plan's formal commit (`c6ea2ec`) is the 16-task implementation. The post-commit hardware-bring-up commits (`c9d2875`..`f30ac4e`) are the correction signal — they fix esp_hosted bootloop, wifi soft-fail, board-entry for a different physical board, and a managed-component constructor patch. None of these were caught by the 4-batch evaluator (all 4 returned PASS) — they were caught by real-hardware flashing. This is the strongest evidence for CODE-HOST-TARGET-01: the checklist's PASS did not predict on-target success.
- **5b (usage-driven notes):** The code-v1 checklist is a generic auto-seed (4 items, all computational or narrow-inferential). It measures **artifact self-consistency** (no TODO markers, tests run, verification exits 0) but not **host-vs-target portability** or **patch durability**. For embedded firmware — where the host-sim/target split is the dominant failure axis — these blind spots are the highest-value additions. The 3 new items are all inferential (anchored to a grep/UPSTREAM check + judgment), matching code-v1's existing inferential pattern (CODE-TEST-LIVE-01).

## Pre-Edit Snapshot (rollback)

`code-v1.md` is preserved unchanged. To roll back: delete `code-v2.md`; the evaluator falls back to `code-v1.md`. Remove the 3 `item_added` rows from `evolution-log.jsonl`.

## Summary

- **Proposals approved:** 3 (all code mode). **Rejected:** 2 (1 too-specific, 1 process-not-artifact).
- **Checklists:** code v1→v2 (3 ADDs). design/plan unchanged this run (plan-mode items deferred to next plan retro).
- **Companion action:** the on-target flashing (this plan's HIL) is what surfaced these — the plan's HIL sheet scenario 1 was updated to PARTIAL with the real evidence. The managed-component patch (`port_esp_hosted_host_init.c`) is recorded in UPSTREAM.md with the re-apply warning. The `cerb-firmware-host-vs-idf-build.md` memory captures the host-vs-target traps for future plans.
