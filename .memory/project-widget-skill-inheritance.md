---
description: Upstream jakubkrehel interface skills must be inherited inside the open-deskos-widget skill, never installed as a standalone skills root.
type: project
why: The user explicitly forbids a top-level .agents/skills/jakubkrehel-skills/ root and requires the upstream entries to live as inherited references owned by the widget skill, keeping the widget workflow self-contained.
---

Upstream `jakubkrehel/skills` interface disciplines (better-accessibility, better-colors, better-interface, better-layout, better-typography, better-ui, better-writing, break, explain-interface, interface-review, variant) are stored ONLY under `.agents/skills/open-deskos-widget/references/jakubkrehel-skills/` together with their `LICENSE` and `UPSTREAM.md` provenance. They must NOT be placed at a standalone `.agents/skills/jakubkrehel-skills/` root.

`open-deskos-widget/SKILL.md` links to them via relative `references/jakubkrehel-skills/<name>/SKILL.md` paths in each workflow phase.

This structure is enforced by the BDD contract in `runtime/linux/tests/features/open-deskos-widget-skill.feature` and `runtime/linux/tests/open-deskos-widget-skill.test.js`, which assert the standalone root does not exist and that all inherited reference entries are present. Verify with `cd runtime/linux && node --test tests/open-deskos-widget-skill.test.js`.
