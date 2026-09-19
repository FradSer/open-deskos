# The release toolchain is declared by the release

## Status

Accepted.

## Context

Release construction installs dependencies, and activation runs preflight and a post-activation
smoke, with pnpm. Both paths used Corepack through the kiosk user's shim, and both passed
`COREPACK_ENABLE_PROJECT_SPEC=0`, which tells Corepack to ignore the version a project declares and
use its own default instead. That default is not a pinned version: it is whatever Corepack resolves
on that device, and it moves when Corepack refreshes its cache.

That drift broke an activation on the CM5:

- Corepack's cache was rebuilt, so it began supplying pnpm 12.4.2 while `integrations/voice-agent`
  declared `devEngines.packageManager` pnpm `^11.22.0`. pnpm refuses to run under a package manager
  that contradicts the declaration, so the voice-agent install failed with
  `ERR_PNPM_BAD_PM_VERSION`. Corepack never reads `devEngines`, so the declaration alone could not
  select a version.
- pnpm's `verifyDepsBeforeRun` defaults to `install`, so `pnpm verify-release` ran a dependency pass
  inside the already sealed release, which is root-owned and non-writable. Relinking command shims
  there fails with `ERR_PNPM_CMD_SHIM_CHMOD`, and the failed smoke rolled the activation back to the
  previous release.

Both failures are the same defect seen twice: the toolchain that builds and runs an immutable
release was decided by the device at run time rather than by the release itself.

## Decision

- Every installable project declares the pnpm that produced its lockfile in `packageManager`
  (`pnpm@11.22.0` for `runtime/linux` and `integrations/voice-agent`), kept exactly equal to its
  `devEngines.packageManager`. Corepack only reads `packageManager`, pnpm enforces both, and an
  exact agreement is what stops pnpm from warning that the declaration is ignored.
- Both the installer and the activation path pass `COREPACK_ENABLE_PROJECT_SPEC=1`, so installs and
  release commands run the pnpm the project declares. There is no ambient default anywhere in the
  release lifecycle.
- The post-activation smoke runs the script package.json declares directly
  (`bash scripts/verify-release.sh`) instead of `pnpm run verify-release`. A sealed release must not
  run a dependency pass at all, and pnpm's install-before-run behaviour is version-dependent.
- `tests/update-runtime-cli.test.js` asserts the declared pin, that both scripts honor project
  specs, and that the smoke invocation stays the script the manifest declares.

## Consequences

- A release is self-describing: installing and activating it use the pnpm the release declares, so a
  Corepack default change can no longer alter how a release is built or run.
- The device must be able to obtain the declared pnpm, from the network or Corepack's cache. A
  missing version now fails loudly during install or activation instead of silently proceeding on a
  different major.
- Upgrading pnpm is a deliberate re-pin of both manifests, which invalidates lockfiles authored by
  the previous major; it is no longer something that happens by refreshing a cache.
- Installing dependencies for the voice-agent integration now downloads pnpm 11.22.0 on the device
  (observed as `Done in 2.7s using pnpm v11.22.0` during a successful activation), which is the
  version that authored its lockfile.
- Verified on the CM5: activation completed, the regenerated `open-deskos-pi-tasks.service` runs
  `/opt/open-deskos/current/...` without `--preserve-symlinks-main`, answers `list` over its socket,
  and stays active across `systemctl --user restart`.