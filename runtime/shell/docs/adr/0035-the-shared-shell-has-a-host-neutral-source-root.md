# ADR-0035: The shared Shell has a host-neutral source root

Date: 2026-10-03
Status: Accepted

## Context

Linux, 64-bit Windows, and macOS run the same Electron Display Shell. Naming
the common source root `runtime/linux` made one host look like the owner of
the implementation. The CM5 Linux panel remains the reference host; it does
not define a separate Shell implementation for each operating system.

## Decision

- Keep the shared runtime at `runtime/shell/`.
- Name the common behavior feature `tests/features/shell.feature`.
- Route operating-system differences through `src/platform/`. Keep CM5,
  Windows, camera, microphone, and peripheral runbooks explicitly scoped to
  their hosts and acceptance gates.
- Declare macOS x64 and arm64 as supported non-reference hosts, retaining
  their existing Unix state paths and separately detected service capabilities.
- Update checkout discovery, integration imports, development instructions,
  deployment staging, and repository skill references together.
- Keep sealed release layouts, service names, runtime channels, and persisted
  state locations unchanged. Source paths are not deployed state identities.
- Retain the internal package identifier `@fradser/open-deskos-linux-shell`
  because Electron derives the existing user-data location from it. The
  package description and public documentation identify the cross-platform
  Shell; changing its stored profile identity requires a separate migration.

## Verification

Checkout-root discovery has a regression using the new directory. Repository
topology verifies the new root, absence of the old root, and compatibility of
the existing Electron profile identifier. Runtime and Personal Bot tests
exercise imports across the new boundary; the isolated Electron fixture gate
checks asset loading from the renamed runtime. Script and documentation
checks validate staging and source references without deploying anything.

Running these gates on a macOS development host is separate from Windows,
CM5, microphone, camera, and physical-input acceptance.
