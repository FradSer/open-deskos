# Widget and App verification

Read this before verification. Runtime acceptance requires an isolated environment on the real CM5 through SSH.
Inspect harness behavior before execution.
Do not show foreground windows, steal focus, use production credentials, or affect production services.
Report a blocker when isolation is unavailable.
Deployment and service operations require separate authorization.

## Evidence and difficult states

Test the final candidate through its actual composition.
Separate source checks, DOM assertions, rendered geometry, operational health, and user acceptance.
A successful component or process does not establish the user's completed task.
A fixture pass does not prove live-source recovery or physical input.
Capture needed images on CM5 and transfer them to the development machine's `/tmp/`.
Label fixture images as examples.
Screenshots support explanation; they do not replace runtime assertions.

Use deterministic success, unavailable, malformed, slow, unauthorized, empty, corrupt-cache, and stale-cache fixtures for external data.
Include long English/CJK, extreme values, missing units, and partial readings.
Check Instrument, Pixel, and Border Beam themes where inherited.
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

## Verification commands

Run from `runtime/shell`.
Start with affected tests, then applicable shared gates.

| Built-in | Installable package |
| --- | --- |
| `node --test tests/<focused>.test.js` | `node --test tests/user-app*.test.js` |
| `node --test tests/pixel-icons.test.js` | `pnpm exec electron tests/user-app-lifecycle.cjs` |
| `pnpm styles` | Package-specific behavior and sandbox checks |
| `pnpm exec electron tests/widget-app-styles.cjs` | `pnpm test` |
| `pnpm exec electron tests/widget-density.cjs` | `bash tests/smoke.sh` |
| `bash tests/smoke.sh` | |

Use `pnpm e2e` for composition, navigation, interaction, themes, or shared surfaces.
Report passed commands, candidate identity, test scope, and unverified device/assistive-technology checks.
For separately authorized deployment, provide outcome criteria, affected dependencies, and recovery requirements to the deployment workflow.
