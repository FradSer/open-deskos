# Plan Checklist v2

- **Version:** v2
- **Mode:** plan
- **Created:** 2026-06-13 (evolved from v1 by retrospective retro-2026-06-13-feasibility-gap)
- **Changes from v1:** ADD RISK-GATE-01, SPIKE-FRONT-01 (variety-gap closure — v1 checked structural plan integrity only: scenario coverage, DAG acyclicity, ref resolution, test pairing. It had no item to catch a make-or-break validation buried as a sub-step of a GREEN impl task, nor a design-named hardware/external unknown that the plan failed to front-load as an early task).

## Purpose

Binary PASS/FAIL checklist for evaluating an implementation plan folder against its source design folder. Each item produces a deterministic or anchored result.

## Artifacts Under Evaluation

- `_index.md` -- plan overview, sprint batching, depends-on graph, milestones
- `task-NNN-*.md` -- individual task files (impl + test pairs)
- Source design folder's `_index.md` -- milestones, quality gates (G-N), named risks
- Source design folder's `bdd-specs.md` -- scenarios the plan must cover

---

## Checklist Items

### PLAN-COV-01 -- Every design BDD scenario maps to at least one task

**Description:** Each `Scenario:` heading in the source design's bdd-specs.md must be covered by at least one task file (matched by scenario title in the task subject line or a BDD Scenario section in the task body).

**Check method:**
```bash
grep -E "^Scenario:" <design-folder>/bdd-specs.md | while read -r line; do
  title="${line#Scenario: }"
  grep -lq "$title" task-*.md || echo "FAIL: scenario '$title' uncovered"
done
```
Any "FAIL" output line means PLAN-COV-01 is FAIL.

**Evidence format:** `N/M scenarios covered; uncovered: {scenario titles}`

**Rework format:** "Add task for scenario: {scenario title}"

**Result:** PASS if every scenario is covered. FAIL otherwise.

`# Type: computational` -- grep for exact scenario titles is deterministic.

---

### DEP-01 -- No circular dependencies in the depends-on graph

**Description:** The depends-on graph defined in `_index.md` must be acyclic.

**Check method:** Walk the depends-on graph from `_index.md`; detect any cycle (task-A → task-B → ... → task-A).

**Evidence format:** `Cycle detected: task-{A} -> task-{B} -> ... -> task-{A}` or `No cycles`

**Rework format:** "Break cycle by removing dependency: task-{A} depends-on task-{B}"

**Result:** PASS if the graph is acyclic. FAIL on any cycle.

`# Type: computational` -- cycle detection on a finite graph is deterministic.

---

### DEP-02 -- All depends-on references resolve to existing task IDs

**Description:** For each `depends-on` entry in `_index.md`, a matching `task-{ID}-*.md` file must exist in the plan folder.

**Check method:**
```bash
grep -oE "task-[0-9]+" _index.md | sort -u | while read -r id; do
  ls "${id}"-*.md >/dev/null 2>&1 || echo "FAIL: $id unresolved"
done
```

**Evidence format:** `Unresolved: {ID list}` or `All resolved`

**Rework format:** "Fix depends-on reference {ID} in {task file} (typo or missing task file)"

**Result:** PASS if every depends-on resolves. FAIL on any unresolved reference.

`# Type: computational` -- file existence check is deterministic.

---

### TEST-01 -- Every impl task has a corresponding test task

**Description:** For each `task-NNN-{slug}-impl.md`, a matching `task-NNN-{slug}-test.md` must exist (BDD-driven TDD requires the RED test before GREEN code). Setup/config/spike tasks (`type: setup|config|spike`) are exempt.

**Check method:**
```bash
ls task-*-impl.md | while read -r impl; do
  test_file="${impl%-impl.md}-test.md"
  [[ -f "$test_file" ]] || echo "FAIL: $impl missing $test_file"
done
```

**Evidence format:** `Unpaired impl tasks: {list}` or `All paired`

**Rework format:** "Add test task for: task-{NNN}-{slug}-impl.md"

**Result:** PASS if every impl has its test pair. FAIL on any unpaired impl.

`# Type: computational` -- file existence pairing is deterministic.

---

### RISK-GATE-01 -- Each design make-or-break validation gate is a standalone task with a pivot branch

**Description:** Every validation the source design flags as make-or-break — a quality gate (`G-N`) or risk tied to "first-week / 复测 / retest / feasibility / 最大未知 / biggest unknown" whose outcome could force an architecture change — must appear in the plan as a **standalone task** (or an explicit decision gate) that records (a) the pass/fail criterion and (b) a pivot branch for the failing outcome. The item FAILs when such a gate is buried as a sub-step (`Step N`) inside a GREEN impl task whose success criteria assume the gate passed, with no pivot path. Burying the project's defining risk inside an impl step mis-weights it: a failing retest is not a step, it is a re-architecture trigger, and the plan must make that branch visible.

**Check method:** `# Type: inferential.` From the design `_index.md`, list quality gates `G-N` and risks marked first-week/retest/feasibility/biggest-unknown. For each, locate where the plan schedules it. FAIL if the gate is a sub-step of an impl task (not its own task / decision gate) OR if no failing-outcome branch is documented anywhere in the plan.

**Evidence format:** `design gate {G-N / risk} scheduled at {task-NNN Step M | standalone task}; pivot branch {found at :line | ABSENT}`

**Rework format:** "Extract {gate} into a standalone decision-gate task with explicit pass/fail criteria and a documented pivot branch for the failing outcome; remove it from the impl task's success criteria."

**Result:** PASS if every make-or-break gate is a standalone task with a pivot branch. FAIL otherwise.

`# Type: inferential` -- gate enumeration from the design is mechanical; the buried-vs-standalone and pivot-branch judgment is anchored.

---

### SPIKE-FRONT-01 -- Each design-named hardware/external unknown is front-loaded as an early task before code that assumes it

**Description:** For every technical unknown the source design names (custom hardware bring-up, external SDK/API behavior, third-party protocol — see design RISK-FRONT-01), the plan must schedule a validating task (spike / bring-up / retest) that runs **before** the implementation tasks whose success depends on that unknown being resolved. The item FAILs when an implementation task depends on an unvalidated design-named unknown and no earlier validating task gates it — i.e. the plan discovers the unknown only at full-implementation time, when the schedule has no slack to absorb a surprise.

**Check method:** `# Type: inferential.` Cross-reference the design's named unknowns (RISK-FRONT-01 set) against the plan task graph. For each unknown, confirm a validating task exists and is an upstream `depends-on` ancestor of the impl tasks that assume it. FAIL if any design-named hardware/external unknown has no front-loaded validating task, or its validating work is fused into the same impl task that consumes the result.

**Evidence format:** `design unknown "{X}" -- validating task {task-NNN | ABSENT}; downstream impl {task-MMM} depends-on it {yes | no}`

**Rework format:** "Add an early spike/bring-up task for {X} as a depends-on ancestor of {downstream impl tasks}; gate the impl tasks on its result."

**Result:** PASS if every design-named unknown has a front-loaded validating task gating its dependents. FAIL otherwise.

`# Type: inferential` -- unknown enumeration from the design is mechanical; the front-loaded-ancestor check is anchored to the depends-on graph.

---

## Evaluation Protocol

1. Run each check method against the plan folder (and its source design folder where indicated).
2. Record PASS or FAIL for each item.
3. For each FAIL, capture evidence in the specified format and produce a rework item.
4. Verdict: all items PASS = **PASS**. Any item FAIL = **REWORK** with itemized rework list.
