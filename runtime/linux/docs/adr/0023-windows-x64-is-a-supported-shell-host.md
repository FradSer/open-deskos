# Windows x64 is a supported Shell Host

## Status

Accepted

## Context

The Display Shell was written for one host, the CM5 (Linux arm64), and its platform assumptions were never separated from the shell itself: process inspection reads `ps` plus `/proc/<pid>/cwd` with an `lsof` fallback, the camera source shells out to `v4l2-ctl`, every entry point is bash, and the optional links (Remote Bridge, personal bot, Desk Link, user-app control) are Unix domain sockets. A 64-bit Windows desk is now wanted, and the transport cannot simply carry over: Node and libuv have no `AF_UNIX` on Windows in any released version, so a Windows host needs its own platform half rather than a portable path.

## Decision

- A Shell Host is the machine and operating system that runs the Display Shell. The CM5 (Linux arm64) remains the reference host; 64-bit Windows is a supported host. Windows on ARM is not.
- Platform-specific behaviour lives behind a platform seam inside `runtime/linux/src/platform/`, not in a second runtime tree, so one release pipeline, one test suite, and one set of Widget/App contracts keep serving both hosts.
- On Windows the seam owns process inspection, state and device locations, executable-name rules, and endpoint naming. Endpoint naming keeps the Unix-socket shape of the existing links and maps it to a Windows named pipe, so a ported link does not invent a second protocol.
- Windows process inspection is owned by an optional native module: `CreateToolhelp32Snapshot` for process identity and parentage, `GetProcessTimes` for start time, and a PEB read over `ReadProcessMemory` for command line and working directory. PowerShell is the degradation source only when the module cannot load.
- The Windows host does not port the Remote Bridge, Personal Bot, or Desk Link. Those surfaces report unavailable rather than degraded, guessed, or silently local, under the same rule that an unaccepted peripheral cannot block base-shell operation.
- Native module build failure must never block shell start. The module is an optional dependency, and its absence degrades the Session Work Directory to unknown.

## Considered Options

- **A second runtime tree (`runtime/windows/`).** Rejected: it splits one Shell into two releases, two test suites, and two drifting copies of the Widget/App contracts for a difference that is confined to a handful of seams.
- **A pure-managed P/Invoke probe, compiled at run time by PowerShell `Add-Type`.** It reaches the same command line and working directory with no build chain and no native artifact. Rejected because inspection fidelity on the target machine must not depend on PowerShell being present, permitted, and unconstrained by execution policy.
- **Named pipes carrying the existing JSON Lines records, to keep the Unix-socket links on Windows.** Not used by this increment, because those links are out of scope, but it stays the seam's endpoint rule so a future port does not need a new transport decision.

## Consequences

- `CONTEXT.md`'s Display Shell entry admits two hosts, and the shell's own documentation must not present the Remote Control, voice, or Desk Link surfaces as available on a Windows host.
- The Session Work Directory reads as unknown whenever the native module is absent or the target process is unreadable (a higher integrity level cannot be opened), and no second source may infer it.
- Native artifacts stay out of Git and are not staged by the release tooling, so a Windows host builds the module once after install; `pnpm preflight` stays green on a host that never builds it.
- `tests/smoke.sh` and `run.sh` remain the CM5 entry points. Windows gets its own launcher and a Node acceptance script, because bash is not a prerequisite a Windows host can be assumed to have.
- Change-caused failures must be fixed on both hosts' checks, but a macOS or Linux development machine cannot execute any `win32` branch. Windows acceptance is executed on a Windows host and reported separately from host-run checks.