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
| 16 | Your apps | Inspected existing lifecycle and native form controls; retained. Full failure/focus lifecycle re-audit not performed. Existing user-app unit suite passes. |
| 17 | Built-in views | Adds explicit empty-catalog and no-match search status with a clear-search recovery instruction. Regression and real-DOM tests. |

Additional registered built-in views in `apps.js`: Calendar, Clock, Pomodoro and Year progress; `pi-sessions.js` also supplies the Pi Sessions view. Existing built-in-view containment tests pass. Calendar/Year remain informational, and Pomodoro's existing Start action only changes runtime state: a real countdown implementation is not part of this interface pass. Status plugins are the clock, connection and Pi Sessions indicators; no status-bar redesign was made.

## Verification

BDD scenarios were added before each corresponding failing test. Six public registration/mount regression tests demonstrated failures before implementation and now pass.

Commands run from `runtime/linux`:

- `node --test tests/widget-sequential-refinement.test.js tests/calendar-density.test.js`
- `pnpm exec electron tests/widget-sequential-refinement.cjs`: six theme/viewport combinations, face-state containment and minimum text size, semantic Clock reading, offline Hydra geometry, catalog search recovery.
- `pnpm styles`
- `bash tests/smoke.sh`
- `pnpm exec electron tests/widget-app-styles.cjs`
- `pnpm exec electron tests/widget-density.cjs --sizes=1920x1280,320x480 --theme=instrument`
- Same density command with `--theme=pixel` and `--theme=border-beam`.
- `pnpm test`: 244 passing tests.
- `pnpm e2e`: zero driver, motion, sweep, interior, density or theme failures, including all six density runs and three theme runs.

Two earlier standalone `--state=live` density invocations timed out waiting for grid geometry to settle. The final full e2e density runs passed; the earlier timeouts are recorded rather than treated as successful checks.

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
