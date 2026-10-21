# Widget and App verification

Read this before verification. Use isolated harnesses for source and renderer checks.
CM5 is the reference host; Windows and macOS share the Shell.
Verify platform-sensitive changes on each affected real host before claiming its acceptance.
Inspect harness behavior before execution.
In isolated harnesses, do not show foreground windows, steal focus, use production credentials, or affect production services.
Report a blocker when isolation is unavailable.
Deployment, activation, service operations, and live hardware capture require separate authorization.
An authorized device capture uses the active interactive session and preserves user input.
A Windows SSH process in Session 0 does not prove interactive Session 1 rendering.

## Evidence and difficult states

Test the final candidate through its actual composition.
For plugin replacement claims, also apply [plugin replacement](plugin-replacement.md).
Separate source checks, DOM assertions, rendered geometry, operational health, and user acceptance.
A successful component or process does not establish the user's completed task.
A fixture pass does not prove live-source recovery or physical input.
Capture device evidence on the affected host; transfer it to the task evidence directory.
Record the candidate identity, active release, source authority, and measurement time.
A running service does not establish fresh data or correct model output.
Label fixture images as examples.
Screenshots support explanation; they do not replace runtime assertions.

## Normal design previews

Use populated, representative readings for normal design review.
Keep success previews separate from failure, stress, and recovery captures.
Do not change shared failure fixtures to make a preview look complete.
Check that every visible data surface has its expected values, units, and labels.
Derive summary facts and component readings from one consistent fixture snapshot.
Populate conversation previews with representative messages, not a transcript of test actions.
Assert decoded images, visible readings, font readiness, and cross-surface consistency before capture.
Capture each supported theme and the applicable reference and compact dimensions.
Assert actual heading visibility, accessible names, header insets, reading containment, and retained layout spans.
Test the absence of removed headings as well as the presence of useful ones.
Enforce heading decisions in shared harnesses across themes and compact Cells, including independent surfaces that share the visual contract.
Do not substitute fixture values for real readings when presenting device screenshots.

When a component lacks a data channel, identify any preview-only display as simulated.
Record the missing product capability separately; a populated preview does not implement it.
Scope fixture controls to the preview and verify their removal after capture.
Never fill missing production data with preview values.

For Shell Home success previews, use [the isolated harness](../../../../runtime/shell/tests/home-preview.cjs).
Its synthetic Camera frame needs no hardware capture or external image provider.
Use the failure harness separately for unavailable states and interaction recovery.

## Native capture

DOM readiness and a paint event do not prove that a native image contains the current frame.
Use `tests/helpers/native-page-capture.js` for the shared Electron capture handshake.
Wait for its acknowledgement, then capture and inspect the actual frame.
Keep native fonts, scale, zoom, gutters, and viewport dimensions in the evidence.
Do not repair capture failures with blind sleeps, repeated full runs, relaxed assertions, or GPU bypasses.

## Difficult states

Use deterministic success, unavailable, malformed, slow, unauthorized, empty, corrupt-cache, and stale-cache fixtures for external data.
Include long English/CJK, extreme values, missing units, and partial readings.
Check Instrument, Pixel, Border Beam, and Liquid Glass themes where inherited.
Exercise keyboard, touch, reduced motion, and screen-reader feedback for interactive Apps.
Check focus, wrapping, overflow, actual text sizes, and reachable recovery controls.
Remove temporary stress routes.
Update every affected verification layer when displayed information changes.

## Density

`tests/helpers/widget-density.js` measures text, SVG outlines, and meters.
The standard resolutions are `1920x1280`, `1920x1080`, `960x640`, `480x854`, and `320x480`.

| Measurement | Meaning | Standard limit |
| --- | --- | --- |
| `fill` | Visible element envelope / inner frame | 54–70%; target 62% |
| `occupied` | Geometric union of element boxes / inner frame | ≥20% |
| `emptyBand` | Largest vertical empty band / frame height | ≤28% |

Read current profiles in `tests/widget-density.cjs`; do not copy old numeric examples.
A nonstandard profile must name its justification.
A measurement limitation covers content that the collector cannot see, such as canvas-painted figures.
Only that class may set `maxEmptyBand` above 0.45.
A single-reading instrument has one numeral and at most one detail line.
Two or more text rows cannot claim sparse-by-design status.
Multi-row text keeps `minOccupied >= 0.12` and `maxEmptyBand <= 0.45`.
Only documented thin-cell telemetry may use a lower occupied floor.
A few short rows in an empty card do not qualify.
Restructure content when these constraints fail.
Do not widen tolerance or lower a floor to fit the measured output.
Change acceptance criteria only for a changed requirement or justified product constraint.

Wait for Montserrat, Noto Sans SC, and Zpix fonts before measurement.
Allow two animation frames and the harness settle period after theme changes.
Mock each invoked preload/IPC endpoint in the isolated density harness.
Missing mocks must not turn intended live fixtures into unconfigured placeholders.
Verify remote-asset bounds, CSP, and actual Electron loading.

## Fixture controls and execution scheduling

Identify every fixture control that changes time, motion, fonts, provider responses, or process scheduling.
For rendered comparisons, record viewport, device scale, page zoom, and font readiness before each measurement.
Apply startup controls before the runtime consumes them; confirm the resulting document state.
Verify each control through observable state before using its measurements.
Successful injection does not establish that the document policy permits the control or that the intended element receives it.
Keep fixture controls scoped to their comparison and remove them afterward.
Verify removal before subsequent assertions in the same document.
Use separate checks for product behavior suppressed during a static comparison.
Do not weaken production policy, motion behavior, or measurement tolerances to repair a fixture.

For coordinated processes, define each readiness checkpoint and the work required before it can occur.
Bound checkpoint waits and observe child termination while waiting.
Preserve the initiating failure and available child diagnostics before cleanup.
Stop dependent mutations and assertions after a required phase fails.
Continue independent scenarios only with their own isolated state.
A checkpoint timeout establishes an incomplete phase; it does not identify a product defect or justify increasing the timeout.

Investigate intermittent failures through their reported errors and execution conditions.
Retain the failing boundary's actual verdict before fixture cleanup or a generic assertion hides it.
Distinguish completed assertions, verified resource release, and actual process closure.
None of these observations substitutes for the others.
A sequential pass alone does not identify the cause of a concurrent failure.
A controlled experiment can establish a possible cause without proving an earlier unobserved failure's cause.
Keep that distinction explicit when historical rendering inputs were not recorded.
When changing test scheduling, retain explicit concurrency scenarios for the affected runtime contracts.
Run the resulting standard command before reporting its gate as passed.
Report scheduling changes and their verification cost separately from product changes.

Read failures across the complete command output before summarizing progress or final results.
Recent output alone cannot establish that earlier checks passed.
Record the final exit status, pass count, failure count, skips, and candidate identity.
Keep a failed shared gate unresolved after a focused rerun passes.
Use the rerun to narrow the investigation; clear the gate only with a successful complete rerun on the applicable candidate.

## Verification commands

Run from `runtime/shell`.
Start with affected tests, then applicable shared gates.

| Tier | Required evidence |
| --- | --- |
| Focused repair | Reproduce the defect; run affected deterministic tests and a representative renderer check |
| Shared interface delivery | Run applicable composition, theme, density, navigation, build, and release checks once on the final candidate |
| Device acceptance | Check the activated candidate and relevant real services or input on the affected host |

Do not repeat unrelated full suites for every spacing edit.
Keep physical input, microphone, live-model behavior, and learning experiments separate when they exercise different boundaries.
After an external failure, check health and use bounded retries; record a persistent blocker instead of restarting unrelated steps.

| Built-in | Installable package |
| --- | --- |
| `node --test tests/<focused>.test.js` | `node --test tests/user-app*.test.js` |
| `node --test tests/pixel-icons.test.js` | `pnpm exec electron tests/user-app-lifecycle.cjs` |
| `pnpm styles` | Package-specific behavior and sandbox checks |
| `pnpm exec electron tests/widget-app-styles.cjs` | `pnpm test` |
| `pnpm exec electron tests/widget-density.cjs` | `bash tests/smoke.sh` |
| `bash tests/smoke.sh` | |

Use `pnpm e2e` for applicable shared composition, navigation, interaction, or theme delivery.
For Widget composition, also use `tests/home-preview.cjs --widget-grid` and the affected surface harness.
Keep complete-gate failures open until the complete applicable command passes.
Report passed commands, candidate identity, test scope, and unverified device/assistive-technology checks.
For separately authorized deployment, provide outcome criteria, affected dependencies, and recovery requirements to the deployment workflow.
