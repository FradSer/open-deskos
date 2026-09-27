# Tailscale is provisioned by the desk, and a host installation is reused

## Status

Accepted

## Context

The desk is operated from outside its own network: SSH, file transfer, and remote work all need a path to the device that does not depend on being on the same LAN, and Tailscale is that path. A host may already have Tailscale installed by its owner, with its own login, its own tailnet, and its own update path. A desk that installs its own copy would fight the host it runs on, and would still not be able to log in as that owner.

## Decision

- Tailscale is part of a desk deployment on the host that runs the shell (64-bit Windows, and the Linux reference host), not an optional extra.
- A host that already has Tailscale keeps it. Detection looks for the command at the platform's own location; when it is present the desk uses that installation and never installs over it, never logs in, and never rewrites its configuration.
- Provisioning happens only when the command is absent, is idempotent, and is an operator command rather than part of shell startup: an installer needs administrator rights on Windows, and the login is the host owner's act.
- The login is never automated with a stored credential. The desk reports `needs-login` and names the step: `tailscale up` prints a login URL, or the tray application offers one.
- The desk states the tailnet state the CLI reported — connected, needs-login, stopped, or other — and every failure as a reason rather than as a state. The shell itself performs no network I/O.

## Considered Options

- **Bundling a pinned Tailscale build inside the release.** Rejected: it duplicates a system installation, bypasses the host's own update path, and could not log in as the host owner anyway.
- **Requiring a hand-installed Tailscale before any deployment.** Rejected as the only path: it leaves reachability as a prerequisite the deployment can neither state nor fill.

## Consequences

- Reachability becomes something a deployment provisions and can report, and the reuse rule is testable without a tailnet: detection, the provisioning decision, and status parsing are pure functions with fixtures (`tests/features/tailscale.feature`, `tests/tailscale.test.js`).
- A Windows installer needs elevation, so provisioning stays a documented operator act instead of something the shell attempts on startup.
- There is no tailnet surface in the shell yet: the status source exists, and its consumer is the next increment rather than a claim made now.