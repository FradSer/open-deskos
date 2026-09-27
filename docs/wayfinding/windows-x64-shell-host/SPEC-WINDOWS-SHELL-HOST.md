# Spec: a 64-bit Windows Shell Host

Status: ready for implementation. Decision record: [ADR-0023](../../../runtime/linux/docs/adr/0023-windows-x64-is-a-supported-shell-host.md). Glossary: [Shell Host](../../../runtime/linux/CONTEXT.md).

## Problem Statement

Open DeskOS runs on one Shell Host, the CM5. A developer who wants the desk on a 64-bit Windows machine cannot get one: process inspection reads `ps` and `/proc/<pid>/cwd`, the camera source shells out to `v4l2-ctl`, every entry point is bash, and the optional links are Unix domain sockets — so there is no Windows path to start, let alone verify. The platform assumptions are spread across the shell rather than confined to one place, which is also why the gap cannot be closed by documentation.

## Solution

A 64-bit Windows machine becomes a second Shell Host for the same Display Shell. Platform differences move behind one seam, so the Widget/App grid, the State Bar, the pages, the user-application lifecycle, and the release pipeline keep serving both hosts from one tree.

On a Windows host the Shell starts without bash, reports the local Pi sessions it can actually see, and states truthfully what that host cannot do: the Remote Control, voice, and Desk Link surfaces report unavailable rather than degraded, guessed, or pretending to be local, exactly as a missing peripheral cannot block the CM5 base shell.

## User Stories

1. As a Windows desk user, I want to install and start the Display Shell on 64-bit Windows, so that I can use the desk without installing Linux.
2. As a Windows desk user, I want the five desktop pages with their Widget grid, so that the desk behaves like the CM5 desk I know.
3. As a Windows desk user, I want the State Bar clock, network indicator, and Pi status to read from this machine, so that the desk is about the machine I am sitting at.
4. As a Windows desk user, I want the default window size to remain the CM5 content size, so that one layout contract governs both hosts.
5. As a Windows desk user with a different screen, I want to override the shell size with the existing configuration, so that the desk fits my display.
6. As a Windows desk user, I want kiosk mode to be reachable, so that the desk can be a fixed panel rather than a window.
7. As a Windows desk user, I want the shell to start without Git Bash, WSL, or any bash installation, so that deployment needs nothing from the Unix world.
8. As a Windows desk user, I want to keep persistent state (installed Widgets/Apps, descriptors, caches) under my Windows application data, so that state follows Windows conventions instead of a Unix dot-directory.
9. As a Windows desk user, I want the Pi Sessions page to list the Pi sessions actually running on this machine, so that the page stays a statement of fact.
10. As a Windows desk user, I want sessions started as `pi`, `pi.exe`, `pi.cmd`, `pi.ps1`, `node <path>\pi.js`, or `npx pi` to be recognized, so that the page does not depend on how I happened to launch Pi.
11. As a Windows desk user, I want a session's goal and modified files to keep coming from Pi's own session metadata, so that the desk's reading survives a host that exposes less process detail.
12. As a Windows desk user, I want a session's working directory shown as unknown when the host cannot read another process's directory, so that the desk never infers a path I did not ask it to print.
13. As a Windows desk user, I want the session list to keep working when the native inspection module was never built, so that a missing build toolchain cannot make the desk unusable.
14. As a Windows desk user, I want one statement of what is missing (an unavailable module, an unreadable process) rather than a silent blank, so that I can tell degradation from fact.
15. As a Windows desk user, I want Remote Link, voice, and Desk Link surfaces to report unavailable on this host, so that the desk does not present a capability the host does not have.
16. As a Windows desk user, I want local touch and keyboard to keep full authority while those links are unavailable, so that the desk stays usable.
17. As a Windows desk user, I want the camera tile to report unavailable without a captured frame, so that a missing `v4l2-ctl` path is stated rather than faked.
18. As a Windows desk user, I want user Widgets/Apps to install, update, roll back, and uninstall on Windows, so that the lifecycle is a property of the desk and not of the CM5.
19. As a Windows desk user, I want a candidate Widget/App to be verified by the same system-owned verifier before it replaces an installed revision, so that the verification boundary does not weaken on a second host.
20. As a Windows desk user, I want to run one acceptance command after installing, so that I can tell a working desk from a broken one without reading source.
21. As a Windows desk user, I want the acceptance command to run without bash, so that I can execute it in PowerShell.
22. As a Windows desk user, I want a documented build command for the native inspection module and a documented consequence when I skip it, so that the extra fidelity is my explicit choice.
23. As a Windows desk user, I want the native module built against Electron's ABI rather than Node's, so that the module the Shell loads is the module that was built.
24. As a CM5 desk user, I want every existing Linux behavior to remain exactly as it is, so that supporting a second host costs the reference host nothing.
25. As a CM5 operator, I want the existing bash entry points and release pipeline to keep working unchanged, so that the CM5 deployment story does not fork.
26. As a maintainer, I want platform facts to live behind one seam rather than in per-host branches scattered through the shell, so that a third host is a seam implementation and not a rewrite.
27. As a maintainer, I want the Windows process-table parsing to be a pure function with fixtures, so that its behavior is verifiable on a development machine that cannot run Windows.
28. As a maintainer, I want the Windows-only native module to be optional at load time, so that a failed or absent build cannot block shell start or fail the release preflight.
29. As a maintainer, I want every configuration variable the Windows path reads to be in the inventory, so that host-specific configuration cannot hide.
30. As a maintainer, I want the Windows acceptance result reported separately from host-run checks, so that "works on macOS" is never presented as "works on Windows".

## Scenarios

Executable scenarios live in [`runtime/linux/tests/features/windows-shell-host.feature`](../../../runtime/linux/tests/features/windows-shell-host.feature). The spec is verified against that file.

## Implementation Decisions

- **One platform seam.** A single module resolves the Shell Host from the host facts and exposes: host identity, the persistent state directory, the runtime endpoint name for a logical link, whether the host provisions the external user-application control endpoint, and the Pi executable-name rule. Nothing else in the shell branches on the host.
- **Host identity.** The seam resolves the platform and reports whether the host is in the supported set (Linux, or 64-bit Windows). `isWindows` states the platform itself, so a Windows host on an unsupported architecture still takes the Windows path and is reported as unsupported rather than silently as a reference host; the shell states that at startup.
- **Persistent state location.** On a Windows host, persistent state appears under the user's Windows local application data root rather than a Unix dot-directory; the existing Unix locations remain unchanged.
- **Endpoint naming rule.** A logical link name maps to a Windows named pipe on a Windows host and to the existing Unix socket path otherwise. This increment uses the rule for the user-application control endpoint only; the ported links keep reporting unavailable.
- **External control endpoint is not provisioned on a Windows host.** The user-application control endpoint exists for an external agent. No such agent is ported, so the host states that the endpoint is absent instead of binding a pipe nothing connects to. Shell-side Widget/App control stays fully available.
- **Windows process inspection is owned by an in-repo native module.** The module enumerates process identity and parentage, start time, command line, and working directory, and returns a working directory of empty string when the target cannot be read. It is built against Electron's ABI, and its absence or load failure is handled at load time.
- **Command-line forms.** The Windows path recognizes Pi launched as a bare `pi` executable with any Windows launcher suffix (`exe`, `cmd`, `ps1`), as `pi` with a script suffix (`js`, `mjs`, `cjs`), and through the existing wrapper chain (`node`, `npx`, `pnpm`, `shell` wrappers, now including `cmd`, `powershell`, and `pwsh`). Command lines are tokenized with Windows quoting rules, not by splitting on whitespace.
- **Degradation source.** When the native module cannot load, the Windows path falls back to a managed process-table read and leaves the working directory unknown. A degraded read is never presented as a complete one.
- **The camera source needs no change.** Its existing conditions (`flock`, `v4l2-ctl`, the device node) are absent on a Windows host, so it already reports unavailable; it is documented rather than ported.
- **Entry points.** `pnpm start` stays the cross-platform development entry. A PowerShell launcher joins it for Windows, and the smoke checks move to a Node script that both hosts invoke so the CM5 path keeps one source of truth.
- **One native owner per fact.** The seam's Windows process source answers with every process it can see, and the shell filters those rows to Pi processes exactly as the POSIX path does while parsing. A process source whose rows the shell treated as Pi processes would let a non-Pi parent hide a live session.
- **One spec, one incremental delivery.** The Widget/App grid, page set, and user-application lifecycle are not re-specified here: they are the existing desk behavior, and the Windows work is the platform half that lets them run.

## Testing Decisions

A good test here states an observable contract: given these host facts or this captured process-table text, the resolved host or the parsed sessions are these. Tests never assert on internal call order, on module structure, or on which branch was taken.

- **Platform seam (primary seam).** Resolved directly with injected host facts: platform, architecture, environment, and home directory. This is the highest seam for host behavior and the only new one.
- **Windows process parsing.** Pure functions over captured text and structured input: the process-table decoder, the command-line tokenizer, executable-name normalization, and the numeric/elapsed conversions. These are exercised on any development host because they never touch the operating system.
- **Session scanning.** Through the existing `scanPiSessions` injection seam (`listProcesses`, `checkProcessAlive`, `agentDir`, `now`), which already exists and already carries the Linux tests. Windows entries enter as injected process rows.
- **Native module boundary.** The loader is tested for its two observable outcomes: a loadable module is used, and an absent or failing module degrades to the managed source with the working directory unknown. The native code itself is not exercised off Windows.
- **Entry points.** The Node smoke script is verified by running it: its checks are the same resolution, skeleton, and inline-style checks the existing bash smoke performs.
- Prior art: `tests/pi-sessions.test.js`, `tests/pi-sessions-source.test.js`, `tests/user-app-control.test.js`, and `tests/config-inventory.test.js` all pass injected collaborators and fixtures rather than touching the host.
- The configuration inventory check requires a documented row for every variable the Windows path reads, with a named consumer file that reads it.

## Out of Scope

- Porting the Remote Bridge, the resident Voice Agent, or Desk Link / Hosted Pi control to Windows. Those surfaces report unavailable.
- Windows on ARM, 32-bit Windows, and non-Windows non-Linux hosts.
- Packaging (installer or portable bundle) and boot autostart.
- Windows hardware acceptance: GPU path, display topology, and touch behavior on a real Windows desk.
- Any change to the remote Pi Sessions source (SSH) or the Desk Link transport.
- Rewriting the CM5 entry points, release tooling, or acceptance scripts to be cross-platform. They keep their current form.

## Further Notes

- **Verification boundary.** The development machine for this work is macOS. It cannot compile or execute the Windows native module or any `win32` branch. Everything recorded here as passing was verified through injected host facts and fixtures on macOS; Windows acceptance is a separate, explicitly reported result.
- **Known native limits.** Reading another process's working directory fails when that process runs at a higher integrity level than the Shell, and the process-table read itself can be refused by policy. Identity and start time are asked for separately from the readable memory, so those survive a refused directory and only the directory degrades to unknown.
- **Known, unfixed, pre-existing.** The recognition rule accepts any program whose first non-flag argument names a Pi script, so `notepad.exe C:\tools\pi.js`, `bash -c "echo pi"`, and the Windows wrapper forms `cmd /c "echo pi"` and `cmd /c "echo pi" 2 > log.txt` read as Pi sessions. This class predates the Windows host and is shared with the reference host; the Windows side inherits it rather than inventing it. Recognition is deliberately independent of an incidental redirection, so the answer is the same with one and without. The consequence is sharper on a Windows host because an accepted row enters the scan's Pi pid set, where a session parented by that pid is discarded as another session's worker — but the parent must be long-lived to suppress anything, and the shapes above are normally transient. Tightening it means an interpreter allowlist and a change to reference-host recognition, so this increment records it instead of quietly changing Linux answers.
- **Risk to watch.** The native module raises the deployment floor for the full-fidelity path (a C++ toolchain on the Windows machine), which is why the degraded path must stay a first-class, tested outcome rather than an afterthought.