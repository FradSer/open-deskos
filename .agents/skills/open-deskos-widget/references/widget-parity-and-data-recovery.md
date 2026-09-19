# Design judgment and acceptance evidence

Read this when refining an existing interface, responding to repeated feedback, changing displayed information, or defining acceptance across a runtime boundary.

## Diagnose the system before adjusting the symptom

Use user-approved surfaces as evidence of the intended visual language. Compare hierarchy, proportion, content boundaries, typography, and information density in their actual context. Reuse the underlying relationships rather than copying isolated values.

Trace ownership through the composition before changing a local property. A visible defect may arise from interacting constraints in a parent, a shared style, a component, or its content. Correct the responsible constraint instead of compensating elsewhere. Minimum sizes and numeric thresholds are safeguards, not design targets.

Translate corrective feedback into an observable outcome before choosing another implementation change. Identify what the user needs to perceive or accomplish, which assumption the feedback challenges, and what comparison or observation would distinguish improvement from another arbitrary adjustment. Use established product context and approved examples first; clarify only when competing interpretations would materially change the result.

When feedback rejects an apparently successful revision, revisit that outcome and the assumption that guided the revision. More iterations of the same adjustment are not a substitute for a better explanation of the mismatch. Evidence may justify keeping the implementation and correcting an expectation, changing the implementation, or reporting an unresolved trade-off; do not assume every correction calls for more code.

## Preserve the information contract

Define what each displayed value means, where it comes from, and how uncertainty is represented. Presentation must preserve distinctions important to interpretation: units, scope, time, completeness, and availability. Avoid plausible-looking substitutions for missing evidence.

Responsive changes may reorganize information but must preserve the requested task and essential content. If space forces a product trade-off, make that decision explicit rather than silently dropping information or reducing readability.

## Match proof to the claim

Separate structural correctness, visual quality, operational health, and user acceptance. Evidence for one does not automatically establish another. State what was measured, what was inferred, and what remains unverified.

Keep acceptance criteria independent of the current implementation. A failing check is a reason to investigate; revise the criterion only when the intended behavior or a justified product constraint changes. Do not redefine success merely to fit the output.

Exercise representative content through the real composition, including extremes and degraded states. When the information contract changes, update every affected verification layer. A simplified fixture cannot support claims about cases it omits. Verification must correspond to the final candidate, with isolated test state and resource cleanup.

## Verify outcomes across boundaries

A component or process being available does not establish that the user's task succeeds. Trace the necessary dependencies to the observable outcome and distinguish intermediate health indicators from end-to-end evidence.

Lifecycle transitions can invalidate assumptions about state, ownership, and continuity. Define expected recovery, a bounded observation period, and truthful behavior when recovery fails. Keep competing explanations provisional until evidence distinguishes them. Distinguish delivery of information from its validity or freshness.

When deployment is separately authorized, hand its workflow the candidate identity, affected dependencies, outcome-based acceptance criteria, and recovery requirements. Follow the supported release procedure and preserve unrelated work. Report incomplete acceptance explicitly rather than treating successful activation as functional completion.

## Keep verification safe

Execute runtime tests through SSH on the real CM5 in an isolated environment, without foreground windows, focus changes, production credentials, or production service effects. Inspect harness behavior rather than assuming that a hidden window proves isolation. If safe execution is unavailable, report the blocker instead of substituting development-machine or foreground tests.

Capture any needed images on CM5 and transfer them to the development machine's `/tmp/`. Label fixture captures as examples. Screenshots support visual communication; they do not replace runtime assertions or prove live-source recovery.

These acceptance requirements do not authorize deployments or service operations. Documentation changes likewise do not establish that the documented behavior has been implemented or verified.
