---
description: Upstream interface skills are inherited as flat references inside open-deskos-widget with a two-phase reading protocol; interface-review is a separate post-creation flow, not an implementation phase.
type: project
why: The user explicitly forbids a top-level jakubkrehel-skills root, requires all upstream entries to live as flat inherited references, and mandates that interface-review be a standalone post-creation process separate from widget implementation.
---

All upstream `jakubkrehel/skills` interface disciplines are flattened directly under `.agents/skills/open-deskos-widget/references/` (no `jakubkrehel-skills/` subdirectory exists; the test asserts `doesNotMatch(/jakubkrehel-skills/)` and `existsSync` is false). There are 51 flat `.md` files totaling ~270 KB: 11 entry documents plus their supporting documents (prefix-named siblings) and operational references (`cm5-deployment.md`, `density-and-styling.md`, `shared-worktree-git.md`).

`SKILL.md` section 6 codifies a **two-phase reading protocol**:
1. Read every linked **entry** reference in its assigned workflow phase.
2. Read the linked **supporting documents** before applying their parent guidance when the widget or its states exercise that concern.

Section 6's implementation workflow contains 5 steps (Recon, Design, Implement, Stress-test, Verify gates). **Review is not an implementation step.** `SKILL.md` section 7 defines a separate **post-creation interface review** that runs only after the widget implementation and its verification are complete. The review classifies introduced regressions separately from pre-existing findings, reports quality, and does not reopen implementation or block deployment.

`DESIGN.md`, the skill itself, product behavior, and machine-checkable runtime contracts remain authoritative over any general recommendation from inherited references.

This structure is enforced by `runtime/linux/tests/open-deskos-widget-skill.test.js` which asserts the reading protocol sentences, the absence of `jakubkrehel-skills`, the presence of `## 7. Post-creation interface review`, the absence of `**Review and verify**` as a workflow step, and that all entry/supporting link targets resolve. The BDD feature adds a scenario confirming review is not treated as an implementation phase or deployment gate. Verify with `cd runtime/linux && node --test tests/open-deskos-widget-skill.test.js`.
