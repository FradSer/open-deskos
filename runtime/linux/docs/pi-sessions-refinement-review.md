# Pi Sessions refinement review

## Scope

Task-local changes to the fourth-page Pi Sessions plugin, its `.pi-*` CSS, and Desk Link session ownership/client framing. Before snapshots were captured before this task because the working tree already contained unrelated edits. Weather, service-plugin architecture, and other concurrent work are not reviewed here. No commit, deployment, kiosk restart, or foreground test was performed.

Stack: framework-free Electron renderer, scoped semantic `--odk-*` tokens, existing Instrument / Pixel / Border Beam themes. Product authority: `PRODUCT.md`, `DESIGN.md`, `runtime/linux/CONTEXT.md`, ADR-0007 and ADR-0008.

Native Pi reference: installed `@earendil-works/pi-coding-agent` 0.85.1 `user-message.js`, `assistant-message.js`, tool renderers, and session selector. The adaptation borrows reading hierarchy, not literal terminal colors or unavailable transcript data. ADR-0012 subsequently adds bounded full result bodies with Markdown and tables.

## Coverage

| Domain | Evidence | Result |
| --- | --- | --- |
| Accessibility | Named native buttons, visible focus, keyboard/Remote routing, keyed focus preservation, explicit close, state text, 44px targets | Introduced focus issues corrected; physical assistive technology not verified |
| Layout | CM5 hidden offscreen Electron DOM assertions at 1920×1280, 960×640, 480×854, 320×480; neighboring App harness at five sizes and 200% zoom | Scoped checks pass |
| Writing | English product copy, All/Working/Settled/Exited counts, unavailable recovery, “Recent session events” rather than a complete-history claim | No actionable task-local finding |
| Typography | Theme font inheritance, CJK/English long goals, wrapping, measured supporting text floor | Scoped checks pass |
| Colors | Semantic tokens; App harness measures supporting/primary contrast pairs at 8.74:1 or higher | Scoped checks pass; no new palette |
| UI | Native-Pi message flow, single-column chooser, explicit selected cursor, quiet surfaces, reduced motion | Scoped checks pass |

## Corrected introduced findings

- Explicit Overview opening now scrolls its selected row into view. Only automatic refresh suppresses scrolling.
- An inactive Pi page cannot intercept Shell arrow navigation after Home/End.
- Activating previous/next in the title row retains that control's focus while Overview is open.
- Duplicate reporter timestamps use finite numeric comparison and receipt order for ties; malformed metadata cannot enter the new coercion crash path.
- Full Markdown results preserve focused table regions and horizontal reading across unchanged refreshes and appended events. Restoration identifies the owning result and table position, so identical tables in different result bodies do not exchange state when the older result is evicted.
- The optional Desk Link service no longer prevents local result-log access.
- Record limits apply to complete UTF-8 byte frames before parsing; oversized fragments are discarded through their delimiter.
- A result outside the local 2 MiB log tail is an explicit limit state, not a false empty successful stream.

Running-session automatic scrolling is intentional: Working always follows the newest event, including on refresh/resize/manual scrolling. Settled and Exited preserve manual reading anchors. This supersedes the earlier all-state reading-stability expectation.

## Verification evidence

All executable checks ran through SSH on the real CM5, in a task-owned `/tmp` copy with isolated HOME/XDG directories, no display variables, and headless Electron. Hidden offscreen rendering is required for genuine compositor scroll events; it does not activate a display window.

- `node --test tests/pi-result-events.test.js tests/pi-session-events-source.test.js tests/pi-sessions.test.js tests/pi-sessions-source.test.js tests/pi-sessions-remote-ui.test.js tests/desk-link-service.test.js tests/pixel-icons.test.js`
- `corepack pnpm styles` (generated CSS matches the existing tracked output)
- `node tests/check_tokens.mjs`
- `node tests/layout-harness.mjs`
- `electron --no-sandbox --ozone-platform=headless --disable-gpu tests/pi-sessions-interaction.cjs`
- `electron --no-sandbox --ozone-platform=headless --disable-gpu tests/widget-app-styles.cjs`
- `electron --no-sandbox --ozone-platform=headless --disable-gpu tests/widget-density.cjs`
- Cross-repository loopback integration: 55 synthetic metadata sessions, two reporters on one machine, service and runtime client. Expected 10 Working / 10 Settled / 35 Exited, all 55 unique identities received.

The dedicated UI harness has 19 scenarios, including state counts, source failures, late responses, handover, focus, native hierarchy, always-follow, and three-theme geometry. Fixture outputs and screenshots are explicitly examples, not proof of real task execution.

Final scoped counts: 87 runtime Node tests, 19 UI scenarios, five-size density checks, and zero failures in the isolated E2E driver/motion/geometry sweep. Reporter package verification on CM5: 33 Node tests, 23 Python test functions through the stdlib runner (pytest unavailable), strict scoped TypeScript 6 checking, and package dry-run. The configured repository-wide TypeScript 7/native compiler and live-model verification were not run.

A bounded Impeccable scan of `shell.css` found advisory-only results: deliberate Montserrat usage and pre-existing non-Pi rules. No new visual rule is justified solely by that static scan.

## Remaining verification limits

- `bash tests/smoke.sh` could not establish native window dimensions under headless Ozone (it reports the hidden native surface as 1×1). Token and eight-size layout checks passed separately; this does not convert the smoke command into a pass.
- Full E2E includes other harnesses with hidden-headless geometry and execution limitations. Its aggregate result is not green. After explicitly initializing the hidden viewport, the isolated E2E main driver, motion, and geometry sweep all report zero failures; that driver-only result does not establish a full `pnpm e2e` pass.
- Physical touch, Remote hardware, GPU/compositor performance on the HDMI display, screen-reader announcements, and the updated online release have not been accepted.
- Protocol v1 replay has no event IDs or replay acknowledgements: reconnecting while a sibling link preserves machine state can duplicate bounded recent events. It is not an exactly-once feed.
- The existing service authentication UTF-8 byte-length issue remains a pre-existing review finding outside this task. Complete-record enforcement was corrected as part of the expanded result transport path.

## Verdict

No unresolved introduced interface finding in the verified Pi Sessions path. Scoped interface review: **Approve**. Full release/hardware acceptance remains incomplete; do not treat this review as deployment authorization.
