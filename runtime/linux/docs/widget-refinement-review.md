# Independent instrument refinement review

## Scope

Trusted Linux built-ins, reviewed in the requested order. No shared visual redesign, token changes, dependency changes, voice/network changes, commits, or deployment. Existing geometry is deliberately retained where tests establish containment and reading density. This pass is not a claim that every reachable provider state has been audited.

## Component ledger

| Order | Surface | Outcome and evidence |
| --- | --- | --- |
| 1 | Clock | Preserves the time node within a minute; native `time` semantics and local machine-readable time. Midnight regression test. |
| 2 | Almanac | Preserves weekday/day/month nodes until the local date changes. Month-boundary regression test. Existing narrow/wide date typography retained. |
| 3 | Year | Preserves unchanged percentage text and meter width; new-year reset regression test. Meter precision retained independently from rounded text. |
| 4 | Chat tile | Retained: truthful pending-integration copy, display-only, neutral state, readable density. |
| 5 | Settings tile | Retained: truthful pending-integration copy, display-only, matching established status layout. |
| 6 | Pomodoro tile | Retained: not-started placeholder and neutral dial; no fabricated countdown. |
| 7 | Pi Sessions tile | Retained: working, idle, unavailable and scan-error branches already explicit. Existing density and scanner tests pass. |
| 8 | Face presence | Corrected misleading Offline primary reading for no-face, unknown-face, starting and no-frame states. Unit and real-DOM state matrix. |
| 9 | Current emotion | Retained: experimental provenance, unavailable and owner-recognition-required states; no inferred emotion when recognition is absent. |
| 10 | Hydra | Offline plant now has an empty meter consistent with its unavailable numeric reading. Missing plants clear watering emphasis. Transition regression plus real-DOM meter check. |
| 11 | WeRead | Retained: bounded quote fitting, metadata, missing-configuration and sync-error states. Further image-load race review remains outside this pass. |
| 12 | Preorder | Retained: local target countdown and theme-aware canvas geometry. Existing image-instrument density profile retained rather than disguised as text density. |
| 13 | Today | Retained: local date and truthful status narrative; existing wrapping test passes. No network changes. |
| 14 | Pi Sessions App | Retained: existing anchored refresh, search/filter, disclosure stability, keyboard and recovery tests pass. |
| 15 | Usage App | Retained based on existing real-DOM verification: wrapping, refresh busy/recovery state, action ordering, touch targets and zoom. No new provider behavior. |
| 16 | Your apps | Retained native controls. Sequential Electron coverage now checks pending catalog, unavailable response, recovery through catalog-change notification, horizontal containment, initial separate-App Back focus, and return to the Application ID input after Back/Escape at both sizes in all three themes. Actual candidate failure, preserved installed revision, restart, rollback/remove/open/close remain covered by the passing lifecycle harness. Manual retry after an initial catalog failure is not provided; recovery here depends on a change notification. |
| 17 | Built-in views | Empty-catalog/no-match recovery plus corrected search handling during pending/failed requests: search no longer overwrites loading/error status. Reload retains the search. Routed Electron tests assert public `endpoint-unavailable` normalization rather than the private IPC error message. |

| 18 | Calendar App | Independently displays a semantic local date, updates at month rollover, and explicitly states calendar events are unavailable. |
| 19 | Clock App | Independently displays semantic 24-hour local time, preserves unchanged minute text, and updates at midnight without live announcements. |
| 20 | Pomodoro App | Removes the unsupported Start action and false Running state; explicitly says Timer unavailable and that no countdown is provided. |
| 21 | Year progress App | Independently computes elapsed local-year percentage and year description; resets at New Year. |

Calendar, Clock, Pomodoro and Year are checked for routed runtime containment and minimum text sizes at 1920×1280 and 320×480 in Instrument, Pixel and Border Beam. Status plugins are the clock, connection and Pi Sessions indicators; no status-bar redesign was made.

## Verification

Historical RED logs from prior workers did not survive; their red-first provenance cannot be independently established. The finishing pass observed a RED regression for missing sequential checks in the recurring e2e gate, then added that subprocess and required its exit status. Additional Your apps coverage verifies existing behavior without a production change. An initial finishing-pass sequential run failed during a rapid close/open transition; the harness now awaits the public close operation instead of racing asynchronous Back clicks between unrelated cases. Actual Back/Escape interactions are verified separately.

Commands run from `runtime/linux`:

- `node --test tests/widget-sequential-refinement.test.js tests/app-interiors.test.js tests/user-app*.test.js`: 48/48 passing in the finishing pass.
- `pnpm exec electron tests/widget-sequential-refinement.cjs`: six theme/viewport combinations, face-state containment and minimum text size, semantic Clock reading, offline Hydra geometry, catalog search recovery.
- `pnpm styles`
- `bash tests/smoke.sh`
- `pnpm exec electron tests/widget-app-styles.cjs`
- `pnpm exec electron tests/widget-density.cjs --sizes=1920x1280,320x480 --theme=instrument`
- Pixel and Border Beam density checks ran in the full e2e gate (not separate finishing-pass standalone commands).
- `pnpm exec electron tests/user-app-lifecycle.cjs`: `USER_APP_LIFECYCLE_PASS`.
- `pnpm test`: 256/256 passing tests in the finishing pass.
- `pnpm e2e`: `E2E_SUB_STATUS: {"driverFailures":0,"motionFailures":0,"sweepFailures":0,"interiors":0,"sequential":0,"density":[0,0,0,0,0,0],"theme":[0,0,0]}`. Sequential verification is now a recurring required gate.

The inherited ledger records two earlier standalone `--state=live` density timeouts; those historical logs were not available to this finishing worker. The finishing-pass standalone Instrument density check and all six full-e2e density runs passed. Expected injected catalog/scanner errors appear on stderr in passing recovery tests.

## Review coverage and limits

| Domain | Evidence | Outcome |
| --- | --- | --- |
| Accessibility | Native time, no high-frequency live region, catalog stable status, existing keyboard/focus/zoom tests | No introduced issue observed; physical screen reader not tested |
| Layout | Existing density and app geometry harnesses; new Face state geometry | No introduced overflow observed |
| Writing | Face availability distinctions and search recovery text | Misleading/absent states corrected |
| Typography | Existing theme, supporting-text, date-width and numeral tests | Existing styles retained |
| Colors | No palette changes; existing contrast tests pass | Existing semantic roles retained |
| UI | No new animations, controls or global styling | Existing quiet presentation retained |

CM5 hardware, physical touch/Remote and assistive-technology acceptance remain unverified. A fresh-agent correctness audit must be arranged by the leader; this worker cannot spawn reviewers. This is a scoped improvement pass, not exhaustive completion of every app's entire state matrix.
