# User application lifecycle

## Decision

User-created applications are local, versioned packages, not modifications of the built-in Shell plugin set. `ODESK_WORKSPACE/apps/<id>` owns drafts. A package contains `manifest.json` and a self-contained `index.html`. The manifest declares schema version 1, ID, name, version, and kind (`widget` or `app`).

The system snapshots exact package bytes, validates the manifest and renders the candidate in a bounded, separate Electron verifier before atomically publishing the installed catalog. Failed verification or persistence leaves the previous installed version intact. Rollback selects a previously verified snapshot and verifies it again. Removal drops the installed entry without deleting drafts or user data.

Installed applications appear on one user-applications page. Widgets are display-only surfaces; apps can be opened and closed. This avoids mutating built-in Home placement or publishing the whole runtime for each user package. A future placement feature can consume the same installed catalog.

## Isolation

The Shell retains its strict CSP. Installed HTML is served over a dedicated local protocol with restrictive response CSP and rendered in an opaque-origin iframe (`sandbox="allow-scripts"`, never `allow-same-origin`). User code receives no preload, filesystem, network, parent DOM, arbitrary system tool or application-install API. The verifier has a hard process deadline. Live iframe isolation is not a CPU/memory quota guarantee.

The first version supports local self-contained UI only. It does not introduce arbitrary native dependencies, package install scripts, background daemons, network permissions, persistent application data APIs or a marketplace. Existing built-in plugins remain trusted runtime code and are not user packages.

## Ownership and trade-off

The application service owns installation and catalog truth. Agent tools and the desktop management page call the same service; agent-generated test results never substitute for system verification. Draft creation can use the coding harness, but activation is a bounded lifecycle operation.

This introduces a distinct package contract rather than loading generated scripts into the Shell global scope. The cost is limited integration capabilities; the benefit is independent package updates and a smaller authority boundary. Validation establishes that a candidate loads under the contract, not that its business logic is correct or safe under every future interaction.

## Acceptance

Create draft, install and display, restart and restore, update successfully, reject a broken update while preserving the old version, rollback, and remove. Test protocol framing, path traversal, symlinks, invalid manifests, renderer exceptions, verifier timeout and missing workspace. Hardware deployment remains separately verified.
