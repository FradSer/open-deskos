# Design Checklist v2

- **Version:** v2
- **Mode:** design
- **Created:** 2026-06-13 (evolved from v1 by retrospective retro-2026-06-13-feasibility-gap)
- **Changes from v1:** ADD FEAS-SCOPE-01, RISK-FRONT-01, ABS-01 (variety-gap closure — v1 checked document self-consistency only; a 5/5-PASS design carried unflagged scope/feasibility/risk-asymmetry/premature-abstraction issues surfaced by human review).

## Purpose

Binary PASS/FAIL checklist for evaluating design artifacts. Each item produces a deterministic or anchored result: two independent evaluators given the same artifacts should produce the same PASS/FAIL outcome. Every FAIL must include file-referenced evidence and a specific rework action.

## Artifacts Under Evaluation

- `_index.md` -- plan overview, requirements, risks, milestones
- `bdd-specs.md` -- Gherkin scenarios
- `architecture.md` -- system architecture and layer descriptions
- `best-practices.md` -- coding and design standards (when present)

---

## Checklist Items

### JUST-01 -- Design must not self-declare NOT-JUSTIFIED

**Description:** A design folder whose `_index.md` carries an explicit "not yet justified" / "do not implement" status declared by the maintainer or a prior brainstorming sub-agent must not pass evaluation. The design's own §0-style status is dispositive — content-quality items below cannot override it. This is the meta-check that prevents the v2.8.x add-bias pattern from being replicated at the design layer: a design folder can pass content-quality items while being self-declared as N=0-justified or activation-gated.

**Check method:**
```bash
grep -nE "STATUS:.*NOT.JUSTIFIED|DESIGN-NOT-YET-JUSTIFIED|DESIGN-CONSIDERED-DEFERRED|DO NOT IMPLEMENT" _index.md
```
Any match is a FAIL. Zero matches is PASS.

**Evidence format:** `_index.md:{line} -- "{matched line text}"`

**Rework format:** Either (a) remove the NOT-JUSTIFIED status from `_index.md` after addressing the underlying activation gate, or (b) move the design folder to `docs/retros/<date>-<topic>-considered-deferred.md` (single-file reject form).

**Verdict precedence:** A JUST-01 FAIL produces REWORK regardless of how content-quality items resolve. Other items still run for completeness in the report, but no combination of content-quality PASS results can override a self-declared NOT-JUSTIFIED status.

`# Type: computational` -- grep against fixed-phrase list produces deterministic match.

---

### REQ-TRACE-01 -- Every requirement ID in _index.md appears in at least one scenario in bdd-specs.md

**Description:** Each requirement identifier (pattern: `REQ-NNN`, `FR-NNN`, or `NFR-NNN`) listed in the Requirements section of _index.md must be referenced by at least one scenario in bdd-specs.md (a `Covers:` annotation on the Feature, or a verification-mapping table entry for requirements not expressible as scenarios). Pattern extended from `REQ-` only, per 2026-06-12 evaluation round 1 (project uses FR/NFR scheme; original pattern made the check vacuous).

**Check method:**
```bash
grep -oE "(REQ|FR|NFR)-[0-9]+" _index.md | sort -u | while read -r id; do
  grep -q "$id" bdd-specs.md || echo "FAIL: $id absent from bdd-specs.md"
done
```
Any "FAIL" output line means REQ-TRACE-01 is FAIL. Empty output means PASS.

**Evidence format:** `requirement ID + absence note`

**Rework format:** "Add {ID} reference to an existing covering scenario or create a new scenario for {ID}: {requirement title}"

**Result:** PASS if every REQ-NNN appears in bdd-specs.md. FAIL otherwise.

`# Type: computational` -- grep for exact ID strings is deterministic.

---

### SCEN-CONC-01 -- All Given clauses use specific data values

**Description:** Every `Given` clause in bdd-specs.md must use concrete, specific data values. Vague placeholders such as "some", "valid", "appropriate", or "relevant" are not permitted.

**Check method:**
```bash
grep -n "Given " bdd-specs.md | grep -iE "\bsome\b|\bvalid\b|\bappropriate\b|\brelevant\b"
```
Any match is FAIL. Zero matches is PASS.

**Evidence format:** `bdd-specs.md:{line} -- "{clause text}"`

**Rework format:** "Replace '{vague phrase}' with concrete value at bdd-specs.md:{line}"

**Result:** PASS if zero matches. FAIL on any match.

`# Type: computational` -- grep against vague-word list produces deterministic match.

---

### ARCH-01 -- No inner-to-outer layer dependencies described

**Description:** architecture.md (or the Detailed Design section in _index.md) must not describe any dependency, import, or reference from an inner architectural layer (Domain, Application) to an outer layer (Infrastructure, Presentation/CLI).

**Check method:** Scan architecture.md for arrows or prose stating an inner layer imports from an outer layer. Patterns: `domain.*infrastructure`, `application.*infrastructure`, `domain.*presentation`. Confirm matches describe an actual dependency direction (not a prohibition such as "domain must NOT import infrastructure").

**Evidence format:** `{file}:{line} -- "{dependency description}"`

**Rework format:** "Invert dependency at {file}:{line}; define interface in inner layer."

**Result:** PASS if no inner-to-outer dependency is described. FAIL on any.

`# Type: inferential` -- grep narrows candidates; evaluator confirms direction vs. prohibition.

---

### RISK-02 -- Each risk mitigation specifies a concrete action

**Description:** Every risk mitigation entry in the Risks section of _index.md must specify a concrete, actionable measure. Vague verbs such as "monitor", "handle", "manage", "address", "deal with", "look into" indicate a non-concrete mitigation when used as the sole action.

**Check method:**
```bash
grep -n -iE "mitigation|mitigate" _index.md | grep -iE "\bmonitor\b|\bhandle\b|\bmanage\b|\baddress\b|\bdeal with\b|\blook into\b"
```
Confirm the flagged verb is the primary action (not a supplement to a concrete measure).

**Evidence format:** `_index.md -- risk "{title}" mitigation "{text}"`

**Rework format:** "Replace vague mitigation for risk '{title}' with concrete action (e.g., specific alert thresholds, retry policy, circuit breaker)."

**Result:** PASS if every mitigation describes a concrete action. FAIL on any vague-only mitigation.

`# Type: inferential` -- vague-verb match is computational; primary-vs-supplement distinction is judgment.

---

### FEAS-SCOPE-01 -- MVP scope is argued minimal: independent capability clusters are justified or deferred

**Description:** The design must contain an explicit, evidence-backed argument that the MVP scope is minimal. For each *independently-shippable capability cluster* (a subsystem with its own hardware surface, protocol, or runtime that could ship as a standalone increment — e.g. a voice/ASR pipeline, a wireless-mesh subsystem, a multi-OS client), the design must either (a) argue it is essential to the core value proposition, or (b) defer it to a later increment. A design FAILs when 2+ independent clusters are bundled into "MVP" with no stated rationale for why they cannot be split. This operationalizes the workspace "challenge the premise" / "match complexity to actual scale" principle at the design layer — a design can pass every self-consistency item while quietly bundling several products into one "minimum" deliverable.

**Check method:** `# Type: inferential.` Enumerate the milestones / FR domains in `_index.md`. Mark each cluster that is independently shippable (own hardware/protocol/runtime boundary). For each such cluster beyond the single core one, confirm `_index.md` carries an explicit minimality/bundling argument (a Rationale entry, an AMB sharpening, or a scope-split note) OR a deferral in the YAGNI/out-of-scope fence. FAIL if 2+ independent clusters are bundled with no split-vs-bundle rationale anywhere.

**Evidence format:** `_index.md -- clusters {A, B, ...} bundled into MVP; minimality/split rationale {found at :line | ABSENT}`

**Rework format:** "Add an explicit minimality argument for bundling clusters {list} (why each cannot be a later increment), or move cluster {X} to the out-of-scope fence with a deferral note."

**Result:** PASS if every independent cluster is justified-essential or deferred. FAIL on 2+ bundled clusters with no rationale.

`# Type: inferential` -- cluster enumeration is mechanical; the essential-vs-splittable judgment is anchored to the independently-shippable test.

---

### RISK-FRONT-01 -- Named unknowns are front-loaded symmetrically; no same-class unknown asserted "known" without validation

**Description:** Every technical item the design *itself* names as an unknown, unvalidated assumption, or major risk (markers: "未知/最大未知/假设/未验证/preview/risk/unknown/TBD", or an external dependency flagged as the project's biggest uncertainty) must be either (a) front-loaded into an early milestone or spike that carries an explicit validation gate, or (b) accompanied by a stated justification for deferral. The item FAILs on **risk-ordering asymmetry**: when the design front-loads some named unknowns (e.g. an SDK concurrency retest) but asserts another same-class unknown is "已知/机械/已验证/known/mechanical/solved" without citing a validating task, spike, or prior evidence. Custom hardware bring-up asserted as "known" with no validating milestone is the canonical FAIL.

**Check method:** `# Type: inferential.` Grep `_index.md` and `architecture.md` for unknown/assumption/known markers (`未知|未验证|假设|preview|unknown|TBD|已知|机械|已验证|risk`). Build two sets: (1) unknowns front-loaded with a validation gate, (2) same-class items (custom hardware bring-up, external SDK behavior, third-party API/protocol) asserted as known/verified/mechanical. FAIL if set (2) contains any item with no cited validating task/spike/evidence while set (1) shows the design *does* front-load comparable risks (proving the asymmetry is a gap, not a deliberate uniform stance).

**Evidence format:** `{file}:{line} -- unknown "{X}" front-loaded at {milestone/task}; same-class item "{Y}" at {file}:{line} asserted "{known-marker}" with no validating task/evidence`

**Rework format:** "Front-load a validation spike/gate for {Y} (or cite the evidence that makes it genuinely known), so risk-ordering treats same-class unknowns symmetrically."

**Result:** PASS if every named unknown is front-loaded or justifiably deferred and no same-class item is asserted known without validation. FAIL on asymmetry.

`# Type: inferential` -- marker grep narrows candidates; the same-class-asymmetry judgment is anchored to the front-loaded set.

---

### ABS-01 -- No abstraction layer for <=2 unproven implementations without justification distinguishing it from rejected abstractions

**Description:** When the design introduces an abstraction layer (port / trait / provider interface / plugin seam) for an externally-substitutable concern, and that abstraction wraps **2 or fewer implementations, none of which is yet proven**, the design must carry an explicit justification for why the abstraction earns its cost — especially when the same design *rejects* another abstraction citing low variant count (e.g. "2 message families = not worth an abstraction layer"). The item guards against the internal inconsistency where one abstraction is rejected for low N while another with equally low N is adopted without argument. This operationalizes "match complexity to actual scale — 2 variants = if/switch, not an abstraction layer."

**Check method:** `# Type: inferential.` Identify (1) abstraction layers introduced in `architecture.md`/`_index.md` (port/trait/provider/interface) and the count of concrete implementations each wraps, and (2) any abstraction the design explicitly *rejects* on low-variant-count grounds. FAIL if an adopted abstraction wraps ≤2 unproven implementations AND has no justification distinguishing it from a rejected low-N abstraction (a genuine swappable-I/O-boundary argument, a regulatory/contractual need, or a proven-first plan counts as justification).

**Evidence format:** `{file}:{line} -- abstraction "{port}" wraps {N} unproven impls; design rejects "{other}" for low N at {file}:{line}; distinguishing justification {found at :line | ABSENT}`

**Rework format:** "Either collapse {port} to an if/switch until a 2nd implementation is proven, or add a justification distinguishing it from the rejected {other} abstraction (swappable-I/O boundary, proven-first sequencing)."

**Result:** PASS if every low-N abstraction is justified or there is no rejected-abstraction inconsistency. FAIL otherwise.

`# Type: inferential` -- implementation counting is mechanical; the earns-its-cost judgment is anchored to the design's own rejected-abstraction stance.

---

## Evaluation Protocol

1. Run each check method against the design artifacts in the plan folder.
2. Record PASS or FAIL for each item.
3. For each FAIL, capture evidence in the specified format and produce a rework item with file, line, and corrective instruction.
4. Verdict: all items PASS = **PASS**. Any item FAIL = **REWORK** with itemized rework list. JUST-01 has verdict precedence: a JUST-01 FAIL produces REWORK regardless of how the content-quality items resolve.
