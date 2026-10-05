# Interface review

Read this only after implementation and required verification are complete, or when the user requests an interface review.
Review is read-only by default.
It does not commit, deploy, switch branches, stash, or rewrite the checkout.
Rendered verification needs an authorized isolated preview.
Otherwise mark runtime and visual claims `Not verified`.

## Resolve scope

Respect an explicit `working`, `staged`, branch, PR, ref, or range target.
Preserve the user's two-dot or three-dot range.
Compare a branch against its merge base.
For a PR, fetch its head into a remote-tracking ref and read files at that ref.
Do not inspect unrelated working-tree copies.
With no target, use commits ahead of the default-branch merge base plus uncommitted work.
Otherwise use uncommitted work.
Include nonignored untracked files when the scope includes local work.
State committed and uncommitted counts separately.
Stop when a merge/rebase is active or the base is unresolvable.
With no change, state the facts and ask for a target.
Never silently substitute the last commit or approve an empty scope.
A whole-repository audit must be requested separately.

Exclude generated files, lockfiles, snapshots, dependencies, and binaries.
Name exclusions.
Review added fonts/images through their consuming source and accessibility behavior.
Expand one importer/caller hop; use two hops for shared tokens and primitives.
Review at most five consumers.
Prefer route entry points, then importer count, then package proximity.
State the unexpanded count and any arbitrary selection.
Read both sides of each hunk and the stated intent.
Check removed accessibility, focus, motion, wrapping, units, values, labels, and state distinctions for equivalent replacements.

## Judge and report

Review accessibility, layout, writing, typography, color, and UI against [design](design.md) and [verification](verification.md).
Name unavailable evidence as `Not reviewed`.
Preserve deliberate product decisions.
Consolidate repeated symptoms at their shared cause.
Each finding needs `path:line`, observed behavior, user impact, and a concrete correction.
Classify it as `Introduced`, `Regression`, or `Pre-existing` from the diff.
Do not infer visual failure from source alone when runtime determines it.

| Severity | Impact |
| --- | --- |
| `HIGH` | Blocks a task, misleads, hides content/controls, risks data loss, or repeats systemically |
| `MEDIUM` | Harms comprehension, efficiency, adaptability, or consistency |
| `LOW` | Isolated polish with limited task impact |

Treat inaccessible controls, invisible focus, pointer-only paths, and ignored reduced-motion settings as `HIGH`.
Treat clipped content at 320px/200% zoom, insufficient contrast, and color-only meaning as `HIGH`.
Treat unreachable full values, hidden paths without cues, and errors without recovery as `HIGH`.
Treat destructive actions without confirmation/undo/distinct treatment and misleading semantic colors as `HIGH`.
Treat motion-only state changes as `HIGH`.
Confirm the owning rule before escalating.

Report target/base/head identity, scope, exclusions, expanded surfaces, domain coverage, findings, and actual verification.
Rank actionable findings by severity and shared impact.
Apply any requested finding cap; never let it hide an unreported blocker.
Disclose excluded findings by count/domain.
Show at most three pre-existing findings separately.
Pre-existing findings do not affect the change verdict.
End with `Block` if any introduced/regression `HIGH` remains; otherwise use `Approve`.
Return corrections to the behavior/test workflow.
