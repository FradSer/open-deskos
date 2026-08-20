# Code Checklist v2

- **Version:** v2
- **Mode:** code
- **Created:** 2026-07-11 (evolved from v1 by retrospective retro-2026-07-11-host-vs-target-managed-patch)
- **Changes from v1:** ADD CODE-HOST-TARGET-01, CODE-PATCH-DURABILITY-01, CODE-SUBAGENT-VERIFY-01 (host-vs-target portability, managed-component patch durability, sub-agent "test is buggy" verification — all surfaced by the P-2 slice's on-target flashing, which the v1 host-only checks could not see).

## Purpose

Binary PASS/FAIL checklist for evaluating produced code artifacts at the end of a sprint batch. Computational items are deterministic; inferential (anchored) items use a deterministic narrow step plus per-hit judgment (see each item's `# Type:` line).

## Artifacts Under Evaluation

- Files created or modified by the batch (per sprint contract `Produced` list)
- Verification commands listed in each task file

---

## Checklist Items

### CODE-VER-01 -- All verification commands exit with code 0

**Description:** Every verification command listed in a task file must be executed independently in a fresh shell and exit with code 0. Do not chain commands with `&&` (a failure in one would mask later results).

**Check method:**
1. Extract every verification command from each task file produced in the batch.
2. Run each command independently in a clean shell.
3. Capture the exit code of each command.
4. PASS only if every command returns exit code 0.

**Evidence format:** For each verification command, record `command`, `exit_code`, and `output_tail` (last 10 lines of combined stdout/stderr).

**Rework format:** "Fix failing verification: {cmd} exits {code}; error: {output}"

**Result:** PASS if all exit codes are 0. FAIL if any exit code is non-zero.

`# Type: computational` -- exit code is deterministic ground truth.

---

### CODE-QUAL-01 -- No TODO/FIXME/HACK/XXX/STUB markers in produced files

*(unchanged from v1 — see code-v1.md for full text)*

**Check method:**
```bash
grep -rn -E '(TODO|FIXME|HACK|XXX|STUB|stub\b)' <produced-files>
```
Patterns are case-sensitive except `stub` which matches case-insensitively via the `\b` word boundary.

**Result:** PASS if grep returns no matches. FAIL on any match.

`# Type: computational`

---

### CODE-QUAL-02 -- No stub implementations (NotImplementedError, pass-only, ellipsis-only bodies)

*(unchanged from v1 — see code-v1.md for full text)*

**Result:** PASS if all three greps return no matches. FAIL on any match.

`# Type: computational`

---

### CODE-TEST-LIVE-01 -- Produced tests actually run; none silently disabled or focused

*(unchanged from v1 — see code-v1.md for full text)*

**Result:** PASS if no produced test disables verification of in-scope behavior. FAIL on any vacuous/skipped/focused test for behavior the batch claims.

`# Type: inferential (anchored)`

---

### CODE-HOST-TARGET-01 -- Host suite green + firmware build green implies on-target boot (when a host-sim AND on-target build both exist)

**Description:** The host test harness and the on-target firmware build are different compilation environments. The host harness typically globs all component sources into one library with relaxed flags and no component boundaries; the on-target build compiles each component separately with `-Werror` flags and requires explicit cross-component dependency declarations. A batch that passes all host checks AND `idf.py build` can still fail to boot on-target — the host green is necessary but not sufficient. This item catches the three IDF-only failure classes that host tests structurally cannot see.

**Check method:** `# Type: inferential (anchored).` Applies only when the plan has BOTH a host-sim test suite AND an on-target `idf.py build` (skip if host-only or target-only). For each, the evaluator confirms:
1. **Cross-component REQUIRES match includes.** For every `odk_*` (or equivalent local component) whose source `#include`s a header from a DIFFERENT local component, that other component appears in the first's `CMakeLists.txt` `REQUIRES`. The host glob library hides this (all symbols in one lib); the target build resolves per-component. Run: for each component, `grep '#include "odk_' src/*.c include/*.h` and cross-check the discovered component names against `REQUIRES` in that component's `CMakeLists.txt`.
2. **No format-truncation time-bomb.** `grep -rn 'snprintf' <produced-c-sources>`; for each hit where the destination is a `char[N]` fixed buffer and a `%s` source is also a `char[N]` (same or larger size), confirm either (a) the destination is sized larger than the source's declared size + the fixed suffix, or (b) the `snprintf` return value is checked (`if (n < 0 || (size_t)n >= sizeof(buf)) return ERR`). The target toolchain applies `-Werror=format-truncation`; the host typically does not.
3. **No `*/` inside C comments.** `grep -rn '\*/' <produced-c-sources>` and inspect each hit inside a comment — a glob pattern like `odk_*/src` contains a literal `*/` that prematurely closes the comment, cascading into a phantom syntax error on-target (the host may compile the file via a different include path that doesn't expose it).

**Evidence format:** `host-target split: {present|absent}; REQUIRES audit: {N components, all match|component X missing Y in REQUIRES}; snprintf audit: {all safe|file:line needs return-check}; comment-*/ audit: {clean|file:line has */ in comment}`

**Rework format:** "Fix host-vs-target divergence: {which of 1/2/3} at {file:line} — {specific fix}"

**Result:** PASS if (a) no host-target split exists (skip), OR (b) all three sub-checks pass. FAIL on any of the three.

`# Type: inferential (anchored)` -- grep enumerates candidates deterministically; the REQUIRES/snprintf/comment judgment is anchored to the specific patterns above.

---

### CODE-PATCH-DURABILITY-01 -- Managed-component / vendored-dep patches are durable and documented

**Description:** A patch to a file under `managed_components/`, `dependencies.lock`-fetched components, or other auto-fetched vendored sources is load-bearing but non-durable — `rm dependencies.lock`, a component-manager re-fetch, or a clean reconfigure can clobber it silently. A boot-critical patch that disappears on re-fetch is a latent boot-failure that no host test or build check will catch (the patch isn't in the build graph as a declared source; it's an in-place edit of a fetched artifact).

**Check method:** `# Type: inferential (anchored).` If the execution (per `git status`, `handoff-state.md`, or `UPSTREAM.md`) touched any file under `managed_components/` or equivalent auto-fetched dirs, for each patched file confirm:
1. The patch is recorded in `UPSTREAM.md` (or the fork's local-changes log) with: the file path, what was changed, why (which gate/blocker it unblocks), and a **re-apply note** stating that a `dependencies.lock` re-fetch will clobber it and must be re-applied.
2. **Preferred (not blocking, but flag as a follow-up):** the patch is re-homed as a fork-local overlay (a local component shadowing the managed one) or guarded by a Kconfig/compile flag, so a re-fetch does not silently regress. A patch that lives ONLY in `managed_components/` with no overlay/Kconfig guard is a latent regression — flag it as a follow-up risk in the evaluation report even if the build is currently green.

**Evidence format:** `managed-component patches: {none|N files}; each documented in UPSTREAM.md: {yes|no, file X missing}; re-apply note present: {yes|no}; overlay/Kconfig guard: {yes|no — follow-up flagged}`

**Rework format:** "Document the managed-component patch at {file} in UPSTREAM.md with a re-apply note; a re-fetch will clobber it."

**Result:** PASS if (a) no managed-component patches exist (skip), OR (b) every patched file is documented in UPSTREAM.md with a re-apply note. FAIL if a patch exists but is undocumented. A documented patch without an overlay/Kconfig guard PASSES but is flagged as a follow-up risk.

`# Type: inferential (anchored)` -- git status / UPSTREAM.md inspection is mechanical; the durability judgment is anchored to the documentation + re-apply-note requirement.

---

### CODE-SUBAGENT-VERIFY-01 -- "Test is buggy" REWORK claims carry run evidence

**Description:** When a sub-agent (implementer or coordinator) claims a test assertion is wrong/unsatisfiable as the cause of a REWORK verdict, that claim is a common false-positive source: sub-agents have been observed to hallucinate test bugs (e.g. claiming a hash is 63 chars when it is 64, or that an assertion is unsatisfiable when the impl is wrong). The `superpowers:receiving-code-review` skill constrains the implementer side (verify each item before implementing), but the code checklist must grade whether the verification actually happened — a "test is buggy" claim with no run evidence is unverified and must not be implemented.

**Check method:** `# Type: inferential (anchored).` If the evaluation report or handoff summary contains any REWORK item whose stated cause is "the test assertion is wrong / unsatisfiable / has a data bug" (grep the rework items for: `test.*bug`, `assertion.*wrong`, `unsatisfiable`, `fixture`, `63.*char`, `test.*data`), for each such item confirm the rework report carries:
1. The actual command that was run to confirm the assertion fails for the STATED reason (not "it should fail because..."), with exit code + output tail.
2. A measurement (e.g. `${#hash}` length, the op-log scan result) — not an eyeballed assertion.
If the claim carries no run evidence, it is **unverified** — the rework must NOT be implemented; the item is re-dispatched with a "run the test first, paste the output" instruction.

**Evidence format:** `"test is buggy" claims: {none|N}; each has run evidence: {yes|no, claim X lacks evidence}`

**Rework format:** "The 'test is buggy' claim at {item} has no run evidence — re-dispatch with 'run the test and paste command+output' before implementing the fix; do not modify the test on an unverified claim."

**Result:** PASS if (a) no "test is buggy" claims exist (skip), OR (b) every such claim carries run evidence (command + output + measurement). FAIL if a "test is buggy" claim is made without run evidence — the rework is blocked until verified.

`# Type: inferential (anchored)` -- grep enumerates "test is buggy" claims deterministically; the run-evidence judgment is anchored to the command+output requirement.

---

## Evaluation Protocol

1. Run all checks against the set of files created or modified by the batch, not the entire repository. The "Produced Files Scope" in the sprint contract bounds the grep set; vendored/upstream trees and third-party deps are excluded (they are introduced, not authored).
2. Each check is independent and produces a binary PASS/FAIL result.
3. Evidence must be captured verbatim from command output, not summarized or paraphrased.
4. Verdict: all items PASS = **PASS**. Any item FAIL = **REWORK** with itemized rework list.
5. CODE-HOST-TARGET-01 and CODE-PATCH-DURABILITY-01 apply only to plans with a host-sim/on-target split or managed-component patches respectively; skip silently if the precondition is absent (note "not applicable: no host-target split / no managed-component patches" in the evidence).
