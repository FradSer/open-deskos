# Handoff: test tiers, matrix gate, nightly workflow, CM5 and Windows hosts

## State

The nightly workflow is green on the default branch. CM5 runs release
`20261104T084519Z-1231660`. Its rollback release is
`20261103T191135Z-1116082`. The Windows handheld keeps release
`20261103-main-5f699d03`. Fifteen staged files match the default branch.
Other files keep the older build baseline. No Windows task or service changed.
The default branch holds this fix and a parallel contributor's five commits.

## Decisions

- Keep `pnpm test` unchanged. Add `pnpm test:fast`, `pnpm test:acceptance`, and
  `pnpm test:matrix` for narrower loops.
- Use one representative rendering combination by default. Restore the complete
  matrix only in the `test:matrix` gate.
- Use eight fast-tier workers on most hosts. Use four on the CM5 reference host.
  Read `ODK_TEST_FAST_CONCURRENCY` for an explicit override.
- Keep two acceptance-tier workers. This protects the CM5 Mali GPU.
- Run the nightly workflow on a GitHub runner. Keep CM5 device acceptance as a
  manual run. The workflow does not run on the device.
- Give software-rendered CI runners the CM5 rendering budget. Set
  `ODK_SURFACE_MATRIX_CI=1` in the workflow.
- Pin the CI virtual screen to 1920x1280x24. This matches the reference host.
- Configure the Electron SUID sandbox helper. Do not pass `--no-sandbox`.
- Align the topology contract with the current 15 scopes. Do not delete scopes
  used by other contributors.
- Fix device preflight assumptions instead of relaxing the gate. Keep every
  product assertion and the two-worker acceptance tier.
- Keep the Windows desk running. Stage source files with hash checks only.
  Do not restart the desk or re-register its tasks for a test-only change.

## Fixes in this task

- `runtime/shell/tests/repository-layout.test.js`: assert topology invariants
  instead of a frozen eight-scope list.
- `runtime/shell/tests/device-gateway-electron.cjs` and
  `tests/device-gateway.test.js`: refresh the pinned renderer skeleton hash and
  add a fast drift guard.
- `runtime/shell/tests/surface-matrix.test.js`: skip the repository-only
  workflow file in a sealed release.
- `.github/workflows/nightly-matrix.yml`: build renderer assets, run the
  Electron installer, resolve the sandbox helper from the pnpm store, and pin
  the screen size.
- `runtime/shell/tests/helpers/hydra-surface-selection.js`: accept an explicit
  environment so CI can select the reference-host budget.

## Device preflight fixes

The device loop fell from 14 failing checks to zero. Four causes were fixed.

- Clock and Weather measurement fixtures accept a one-pixel content bound.
  The CM5 window reports 1919 by 1279 for a 1920 by 1280 request.
- The Main Hydra fixture resolves the Remote Bridge from the sealed release
  layout, and from the repository root in a development checkout.
- `docs/CONFIGURATION.md` inventories `ODK_PERSONAL_AGENT_MODEL`.
  `scripts/capture-agent-states.cjs` uses the current technical namespace.
  `tests/local-channel.test.js` asserts the frame cap instead of the old
  handshake cap.
- The installer packaging fixture creates RELEASE_DIR before sealing. The
  closeout fixture supplies a readable process view through its injected io
  seam when init namespace links are root-only. Product checks stay intact.
- One App Manager Electron test failed in a full run. An isolated rerun passed
  8/8 on the new release and 5/8 on the old release. Treat it as a load effect.

## Blockers

- Real-device acceptance reports one required failure: `touch-devices`. The CM5
  has no touch-named evdev device. This is a hardware state, not a Shell defect.
  Kiosk, smoke, display mode, GPU renderer, active release and rollback release
  all pass. `pi-sessions-remote-source` is an optional failure.
- Unactivated candidate releases remain on CM5. Each uses about 869 MB. Do not
  delete them without authorization. Staging directories are clean. No release
  pointer references them. Confirm no deployment is in flight before cleanup.
- The Windows workspace `C:/Users/frads/open-deskos` holds a stale gitdir file
  and a partial old snapshot. The desk runs from the immutable release tree.
  Do not treat the workspace as a source of truth.
- The Windows active release still reports sourceCommit `5f699d03`. Only 15
  files were staged. A full release build and task re-registration are pending
  an operator decision. Keep `source-receipt.json` unchanged. It records the
  build baseline, not the staged files. Activation scripts compare that baseline.
  Editing it would create a mixed-commit release.
- Another session keeps in-flight edits in the shared checkout. Do not stage
  that work. A merge commit preserves its five commits and this fix together.

## Verification

- `pnpm test`: 3029 checks, 3025 pass, 4 skipped, 0 fail.
- Affected contracts: 208/208 pass. Device preflight loop: 127 checks,
  126 pass, 1 skip, 0 fail. Full device preflight passed on activation.
- Nightly workflow `41805171732`: success, 10m57s on `5388505d`.
- CM5 `scripts/cm5-acceptance.sh` with kiosk DISPLAY=:0: 32 checks, 1 required
  failure. See Blockers.
- Windows hash gate: 15/15 archive checks, 15/15 deployed checks, and 15/15
  independent read-back checks. Seven staged JS files pass `node --check`.

## Paths

- `runtime/shell/scripts/test-tiers.cjs`
- `runtime/shell/scripts/test-matrix.cjs`
- `runtime/shell/tests/helpers/surface-matrix.js`
- `runtime/shell/tests/features/surface-matrix.feature`
- `runtime/shell/tests/features/test-tiers.feature`
- `.github/workflows/nightly-matrix.yml`
- `runtime/shell/docs/CONFIGURATION.md`
- `runtime/shell/tests/features/config-inventory.feature`
- `runtime/shell/docs/WINDOWS_HOST.md`
