# Codebase audit and cleanup — 2026-10-03

## Coverage and interpretation

This review inventoried all 1,900 tracked entries across the active Electron
Shell, integrations, peripherals, preserved device research, Apple companion,
and development tools. Automated parsing covered 336 tracked JavaScript files,
21 shell scripts, and 27 Python files. An exact-content scan found no duplicate
source files. Manual inspection concentrated on active runtime boundaries,
channel lifecycle, test redundancy, descriptor generation, and unused frontend
exports. This is repository-wide inventory and verification, not a claim that
every line of bundled vendor code received manual review.

The starting working tree was clean. Changes remain local and uncommitted.
No deployment, service installation, release activation, flashing, live
camera/microphone capture, or real model/provider call was performed.

## Repairs and acceptance evidence

### Personal Bot transport

- Track all accepted connections separately from authenticated broadcast
  clients. An idle peer that never handshakes must not prevent server shutdown.
- Apply the Windows authentication-line bound to that line, rather than the
  whole coalesced authentication/command packet. Retain the command and total
  input limits; an oversized coalesced command remains rejected.
- Recognize the actual Windows named-pipe path separator, reject a pre-aborted
  request before connecting, and reject EOF without a complete response
  immediately instead of waiting for the request timeout.
- Remove duplicate listeners and unused imports. Enable TypeScript unused
  local/parameter checks so this cleanup has a continuing check.

Given/When/Then cases were added in the integration's existing feature layout.
Regression tests demonstrated the idle-shutdown and coalesced-packet failures
before the implementation. The focused final channel run passes 31 tests,
including named-pipe stand-ins on macOS; these do not prove native Windows ACL
or named-pipe behavior on a Windows host.

### Descriptor generation and Python hygiene

- Resolve the code generator from the test file's location, so invoking the
  test outside the repository root works.
- Escape descriptor strings as C literals, preserving quote, backslash,
  trigraph, newline, tab, NUL, and control bytes. The existing regression now
  compiles the generated C with warnings treated as errors and compares the
  emitted bytes. Both the working-directory and string-escaping failures were
  reproduced before their fixes.
- Remove unused imports/assignments while preserving a relinker call's side
  effects. Correct invalid Python escape spellings without changing their
  runtime values. Public generator APIs now carry type annotations.

### Remove redundancy without removing behavior coverage

- Delete the unused research frontend `Section` component, unused `TextArea`,
  duplicated client field mapping and unused client/state helpers. A repository
  consumer search and frontend typecheck/build verified these removals.
- Remove the C test that only checked constant arithmetic; real Lua and tick
  tests still exercise the harness.
- Consolidate duplicate large verifier-payload checks. The file-channel test
  checks that large Buffers never enter the verifier request, while the real
  Electron acceptance test still verifies the exact 256 KiB HTML boundary.
  Large padding is an HTML comment rather than a single visible unbroken word,
  avoiding unrelated layout work and the reproduced timeout.
- Update the repository-layout test to accept the existing `research` commit
  scope instead of changing the project's authoritative scope configuration.

The frontend output decreased from 257,846 to 257,448 bytes. No preserved
research subtree, generated release artifact, or vendor directory was removed.

### Pixel Pi Sessions and geometry harness

The initial complete Electron interaction run failed Pi density at three
Pixel viewports (13.9%, 17.3%, and 15.0%, below its existing 19% lower bound).
The narrow Zpix digits and capped summary text caused the sparse reading.
Simple readings now give the count more space; readings containing a goal or
activity retain the smaller count so long text remains bounded. Remove the
duplicate viewport override and allow the summary's shared cell-relative type.
No density threshold or readability floor was weakened.

The existing real-window style test now covers 36 combinations: working goal,
idle goal, empty scan, and a three-digit running count across three actual
panels and three themes. Existing
source/failure tests also check that the detailed-state class clears after a
goal disappears. The screenshot harness now restores the hidden pager's
horizontal scroll after capturing another grid page; its repeated-width
viewport sequence failed before this fix and now completes with captures.

The follow-up `fix all` pass reproduced a remaining Pixel three-digit clipping
bug on the handheld panel. Longer counts now use the existing compact count
size; the larger one/two-digit hierarchy remains intact. A Range measurement
asserts that the actual rendered digits fit the metric row, and a same-mount
refresh test asserts that the wide-count state clears when the count shortens.
The new regression failed before the fix and the 36-case window matrix plus
91 focused Node tests passed afterward.

The follow-up independent reviewer reproduced an out-of-order Tile scan race:
a late old success could restore `123` after a newer idle reading, and a late
old error could replace that reading with unavailable. The Tile now uses a
generation token. Both response and exception paths ignore results older than
the latest applied result; cleanup invalidates pending work. Comparing against
the latest started request would starve reads when scanning exceeds the poll
interval, so a separate slow-poll regression reproduces and prevents that case.
Deferred-response regressions for old success and old error failed before the
repair and now pass; additional checks cover completion after disposal and
usable readings while the next poll remains pending. All 38 related Node tests
pass after the final ordering refinement.

### Installed Widgets on compact grids and truthful test exits

Final log inspection caught a user-Widget assertion even though the Electron
child reported exit zero: destroying its final window before asynchronous
profile cleanup let default shutdown win over the intended failure exit.
Keep the harness alive until cleanup and explicit exit complete. The same
failing geometry then correctly returned exit one.

The actual rendering failure came from persisted fourth-column placement being
applied directly to a one-column grid, creating a 46px implicit track. Route
installed Widgets through the existing composer placement decision on catalog
reconciliation and resize. Compact layouts now auto-place a single cell, and
larger layouts restore the persisted column/row without remounting the iframe.
The real-window regression covers three themes and both 1920px and 320px
widths, including restoration and frame identity. This repair changes only
rendered placement; stored placement and catalog collision checks are retained.
The reviewer identified an invalid occupied-Home fixture. The final targeted
test uses two free Reading cells and also asserts no overlap with built-ins.
The complete interaction suite passed before this final fixture-only
refinement; the changed real-window test passed again afterward.

## Verification

All commands ran locally with temporary profiles/build directories and fixture
data. Counts below distinguish passed, skipped, and host-only checks.

| Surface | Check | Result |
| --- | --- | --- |
| Shell | `pnpm test` in `runtime/linux` | 722 passed, 2 Windows-only skips, 0 failed (724 total) |
| Personal Bot | `pnpm test` | 432 passed, 1 Windows ACL skip, 0 failed (433 total) |
| Personal Bot | `pnpm typecheck` | Passed, including unused local/parameter checks |
| Bot/channel regressions | Focused transport tests | 31 passed |
| Remote Bridge | Node test suite | 19 passed |
| Python | Affected integration/peripheral test suites | 20 passed |
| Python static checks | Ruff F821/F823/F401/F841/F811; AST parsing with SyntaxWarning as error | Passed for all 27 tracked Python files; not a full style-lint claim |
| JavaScript/shell parsing | Node syntax checks; shell parser checks | 336 JavaScript and 21 shell files passed |
| Research frontend | TypeScript check and production build | Passed; output reduced by 398 bytes |
| S3 Remote host | CMake build and CTest | 1 suite passed |
| Research firmware host | CMake build and CTest | 22 suites passed |
| Active S3 and P4 firmware | ESP-IDF 6.0.1 target builds | Both passed; no flashing |
| Apple management | Local packaging acceptance script | Passed; unsigned temporary build |
| Apple CLI | Universal release build and CLI acceptance | Passed; intentional unwritable-state fixture warning |
| Wispr sidecar | Local authentication fixture script | Passed; no real provider request |
| Shell layout | Eight-size layout harness | Passed |
| Shell geometry | `pnpm geometry` | Passed, including 36 Pi style cases |
| Pixel density with screenshots | Five default viewports, unavailable fixture | Passed, zero violations |
| Shell interaction | `pnpm e2e` | Passed; all driver, motion, sweep, interior, composition, density, and theme sub-statuses zero |
| Installed Widget responsiveness | `electron tests/user-app-desktop.cjs` | Passed after a reproduced failure with exit one |
| Diff integrity | `git diff --check` | Passed |

Detailed local logs use the `/tmp/open-deskos-audit-` prefix. Notable evidence:
`shell-final.log`, `bot-final.log`, `channel-final.log`, `python-final.log`,
`geometry-final.log`, `pixel-capture.log`, `pi-style-final.log`, and
`e2e-final.log`. Pixel widget screenshots are in
`/tmp/open-deskos-audit-pixel-after/`; these are local captures, not device
acceptance or published artifacts. Injected scanner/control failures print
expected error traces in geometry and interaction logs; process exit status
and test assertions determine the result.

Follow-up logs use `/tmp/open-deskos-fixall-`: `count-red.log`,
`race-red.log`, `race-final.log`, `shell-final.log`, `style-final.log`,
`geometry.log`, and `e2e-final.log`. An initial full Shell run concurrent with
the heavy geometry harness hit two verifier-startup timeouts. The isolated
rerun passed at the original 12-second deadline; the final 724-test run also
passed without timeout or assertion changes. Heavy Electron suites were then
run sequentially.

## Independent review and remaining boundaries

A fresh reviewer independently checked the channel bounds/lifecycle,
pre-abort/EOF behavior, descriptor escaping, deleted consumers, and retained
verifier coverage. It found no blocking issue and independently passed the
31 focused channel tests and Personal Bot typecheck. The Pixel/harness changes
received a separate follow-up review before closing this audit.
The installed-Widget composer integration and test-exit repair also received
independent review: no blocking issue, real-window acceptance passed, and 24
related Node tests independently passed. Its fixture-overlap finding was
corrected and the affected real-window check rerun afterward.
The follow-up independent reviewer found the Tile ordering race above; after
the repair and slow-poll refinement it confirmed the P1 closed and independently passed 38 related
Node tests. Its BDD placement note was addressed by keeping scan-ordering and
disposal scenarios in `tests/features/pi-sessions.feature` and numeral geometry
in `tests/features/widget-density.feature`.
The final ordering refinement was verified again by the complete 724-test
Shell suite and the 36-case real-window style matrix. The full interaction
run also returned zero for every sub-status; its early driver window preceded
that final refinement, whose out-of-order behavior is covered by the deferred
Node regressions rather than the synchronous interaction fixtures.

Native Windows execution, Windows-only skipped cases, physical CM5/Windows
touch/keyboard acceptance, USB peripherals, camera/microphone capture, external
provider behavior, and every preserved firmware board variant remain
unverified here. Host builds and fixture-based Electron checks must not be
reported as those outcomes. There is no repository-wide JavaScript lint
configuration; parsing and tests do not substitute for a configured full lint
suite. No observed local failure is hidden by deleting its behavior coverage.
