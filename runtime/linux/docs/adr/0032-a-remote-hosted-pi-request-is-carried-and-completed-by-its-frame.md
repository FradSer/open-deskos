# A remote Hosted Pi request is judged by its target's rules and completed by its frame

## Status

Accepted

## Context

The Voice Agent drives Hosted Pi sessions on a configured CM5 or Mac by running that host's own control helper: one bounded version-1 JSON line on standard input, one correlated response on standard output. Everything about that exchange was written on a Unix host, and a Windows Shell Host running the same coordinator broke it in two places that only appear once the request actually crosses the network.

A Windows OpenSSH client does not relay a piped stdin to a remote command. The helper read nothing, timed out, and the coordinator reported a refused control request — a failure that looked like a wrong credential, a wrong project or an unreachable host, and was none of those. Handing the same bytes over as a file on standard input reaches the helper unchanged.

The same client also keeps the session open after the remote command has finished. The client waited for the helper to exit, so a request that had been answered in three milliseconds was reported as a control timeout, and the answer was discarded with the session. Waiting for a process to exit is the wrong completion signal for a protocol whose answer is a single correlated frame, and it was the wrong signal everywhere, not only on Windows.

The third problem was in the coordinator's own validation, and it never touched the network: a remote target's project is a path on that host, and the desk normalized it with its own rules. On Windows that rewrote every separator and prefixed a root, so every project the desk was configured to carry came back as invalid.

## Decision

- A remote target's project is judged by the target's rules: an absolute POSIX path with no parent segment and no control characters. A local target keeps the local rules, and a local target's project is still the only kind this desk can resolve.
- The one bounded request is handed to the helper as a private file on its standard input. There is no pipe to write, drain or fail, and the file is removed with the exchange.
- The correlated frame is what completes the request. The process that produced it is stopped once the frame has arrived, and a helper that exits non-zero *after* a valid response does not undo a completed request. A helper that answers nothing is still a control timeout, with the reason the transport already used.
- The target keeps its own admission: the desk sends the project verbatim and the daemon's refusal is the answer.

## Considered Options

- **Waiting for the helper's exit as today.** Rejected: on a host whose client leaves the session open, every answered request becomes a timeout. The exit status was never the fact; the correlated reply is.
- **Passing the request as a command-line argument so no stdin is needed.** Rejected: MANAGED_TASKS.md forbids appending a prompt or project to the helper precisely so a request never reaches a process list, and that rule holds on every host.
- **Keeping the pipe and requiring a Windows-capable client.** Rejected: it makes the desk's capability depend on which SSH build a host ships, and a file is the same bytes everywhere.
- **Repeating the target's root policy on the desk to validate the project.** Rejected twice over: it is the host's admission to own, and on a Windows desk it also made the desk refuse paths its own configured roots had just reported.

## Consequences

- A Windows Shell Host drives a Hosted Pi session on a configured host: `start`, `status`, `list`, `prompt`, `cancel` and `end` all cross the same transport they cross from a Unix desk.
- One request leaves one private file and one short-lived process, on every host, and neither survives the exchange.
- A transport that answers late, or never exits, is now visible as a timeout instead of as a completed request reported as failure.
- Verified on a 1280×800 handheld against a Mac Hosted Pi host: `start` answered `running`, `status` answered `settled`/`finished` with the session's reply, `list` answered both sessions, `prompt` was accepted and `end` answered `finished`.
