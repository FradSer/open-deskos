# Service Plugins: Widgets/Apps provide CM5-resident services

## Status

Accepted

## Context

Open DeskOS plugins today own only the presentation layer (tile/page/status/app). Installed user packages are explicitly opaque HTML with no network or background-service capability. Real account state such as Futu holdings needs the opposite: a CM5-resident process with LAN egress and a trading credential, neither of which may enter the renderer sandbox.

The Futu demand is the first instance: the existing NAS `FutuOpenD` gateway stays untouched (no new containers), while everything new runs on the CM5. A one-off built-in source (the Weread pattern) would ship fastest but would entrench a second plugin tier and leave the next data demand (solar, billing, subscriptions) to reinvent the same machinery.

## Decision

- There is a single unified plugin model: Widget (grid tile) and App (own page). The separate User Application concept is retired and must not appear in new manifests or docs.
- Any Widget/App may additionally provide a Service Plugin: a CM5-resident service running as an independent process with its own lifecycle that supplies data to the Display Shell.
- A service is declared in the package manifest (service id, exec entry, version, secret names, egress allowlist). Installing, updating, rolling back, or uninstalling the package revision directly drives the service's systemd user unit; a service has no lifecycle independent of its package revision.
- The system-owned verification gate is the only door: a package revision whose service declaration fails verification can never replace the installed revision.
- The service talks to the shell over a Unix domain socket at `$XDG_RUNTIME_DIR/open-deskos/<service>.sock` with versioned JSON frames, following the voice-agent and Desk Link Service precedents. No new TCP listening surface is added.
- Secrets are plugin-provided through a system vault: the service declares the credential names it needs, the shell renders a system-owned prompt for collection, the user authorizes once, values rest in the vault, and the service process receives them by name at runtime. Values never enter the package, the release, or plugin-drawn UI.
- Egress is declared in the manifest and enforced; an undeclared destination is refused, not merely logged.
- Failure semantics: a dead service renders its tile `unavailable` and never blocks shell boot, generalizing the independent peripheral-gate principle.
- The Futu holdings demand is the first Service Plugin instance. Its external Docker transit (the pre-existing NAS gateway) is accepted as a data source, not as part of the plugin.

## Consequences

- The shell gains its first plugin-owned process. A crashing service cannot take down the shell, and a revoked package stops its service.
- Every future account-data demand reuses the same manifest, verification, socket, and secret conventions instead of negotiating a new seam.
- The installer, verifier, and manifest schema all grow a service dimension; existing display-only packages are unaffected.
- Tokens and credentials remain out-of-band provisioning work per service; the platform is not a secret-discovery protocol.
