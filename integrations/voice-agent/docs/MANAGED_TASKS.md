# Hosted Pi sessions on a configured host

## Scope

A voice request, or a Console on another machine, can start a new Pi coding session on a configured CM5 or Mac, send it further instructions, query its outcome, or end it. A host daemon owns the session; terminating an SSH helper or closing voice feedback does not terminate coding.

The session is persistent and interactive: it survives across turns, accepts further prompts, publishes its events, and, from a Console, can be attached to, steered mid-turn, cancelled, and ended. This replaces the earlier one-shot behavior, whose contract said tasks were "not interactive terminal windows". See [ADR-0014](../../../runtime/linux/docs/adr/0014-hosted-pi-drops-the-edit-and-test-guardrail.md) for the capability decision and [ADR-0013](../../../runtime/linux/docs/adr/0013-desk-link-carried-hosted-pi-control.md) for the control channel.

Each host needs Node 22.19+, this integration's installed dependencies, Pi authentication under the same non-root user, and a trusted writable development directory. This is a coding harness, not a filesystem sandbox: Pi's file and bash tools have the service account's permissions. Root checks govern session admission, not every command the model could execute.

Default instructions require Chinese replies, project guidance, behavior-first tests, and truthful verification reporting. They no longer prohibit commits, pushes, installation, deployment, or service restarts: those prohibitions were system-prompt instructions over an unrestricted tool set, so removing them changes the likelihood of a mutation rather than the ability to make one. A request that arrives as a spoken utterance now reaches the same capability as one a person drove from a Console, which is the accepted risk recorded in ADR-0014. The host loads no extensions, skills, or prompt templates, so a session's capability is the host's tool set rather than everything a full Pi installation could do.

## Host configuration

Create a private `~/.config/open-deskos/pi-tasks.json` owned by the service user. Substitute that host's actual absolute paths:

```json
{
  "roots": ["/absolute/development/root"],
  "stateDir": "/absolute/private/state/pi-tasks",
  "socketPath": "/absolute/private/run/pi-tasks/control.sock"
}
```

An optional `model` uses `provider/model-id`. The socket's parent directory must be dedicated to this service; do not point it directly at a shared system directory. Keep configuration mode `0600` and parent directories private. Do not put keys in this file; Pi uses its normal user credential store.

Run the daemon in the foreground first:

```sh
ODESK_TASK_CONFIG=/absolute/path/pi-tasks.json node src/task-daemon.mjs
```

Install the matching service template after substituting all placeholders:

- Linux: the CM5 installer stages `systemd/open-deskos-pi-tasks.service` into the user's systemd directory with the stable `/opt/open-deskos/current/integrations/voice-agent` path. It enables and restarts the service once `~/.config/open-deskos/pi-tasks.json` exists, and otherwise leaves the unit staged but stopped, because the daemon exits on a missing configuration. Installing by hand means substituting the same stable integration directory — never a dated `releases/<id>` directory, which the next update replaces and locks — and the Node bin directory. The daemon resolves its own entry point through the symlink, so it needs no `--preserve-symlinks-main` flag.
- Mac: `launchd/com.open-deskos.pi-tasks.plist` → `~/Library/LaunchAgents/`. Substitute installation directory, Node bin directory and home directory. Validate with `plutil -lint` before loading into the user's launchd domain. Substitute a stable installation directory, not a versioned or dated one.

Neither template starts automatically merely because it exists in this repository. The session service is independent of the voice daemon. Linux keeps `/opt/open-deskos` read-only.

The host process is separate from the Desk Link Service on purpose: the host owns Pi credentials and session storage, and the service restarts on failure, so a service restart must not end live sessions. When a Console drives this host, the service connects to the socket configured here.

## Control helper

Create an executable launcher on each host with fixed operator-supplied paths:

```sh
#!/bin/sh
export ODESK_TASK_CONFIG=/absolute/path/pi-tasks.json
exec /absolute/node/bin/node /absolute/voice-agent/src/task-cli.mjs
```

The helper accepts one bounded version-1 JSON line on stdin and writes one correlated response. The daemon must already be running. Do not append a prompt, project, password, or shell command to this launcher.

## Voice target configuration

Create a private file on CM5 and set `ODESK_TASK_TARGETS_FILE` in `voice-agent.env` to its absolute path:

```json
{
  "targets": [
    {
      "id": "cm5",
      "name": "CM5",
      "executable": "/absolute/local/pi-task-control",
      "roots": ["/absolute/cm5/development/root"]
    },
    {
      "id": "mac",
      "name": "Mac",
      "host": "user@mac-host",
      "executable": "/absolute/mac/pi-task-control",
      "roots": ["/absolute/mac/development/root"]
    }
  ]
}
```

Configure SSH keys and known hosts for the CM5 voice service user separately. Reaching a host over SSH uses batch authentication, strict host-key checking, and a fixed executable. Prompts travel only as JSON stdin. The model chooses a configured target ID and project, never arbitrary SSH hosts or executable paths.

Restart the voice service after configuration. `coding_targets` describes configured destinations, not proven availability. Confirm each host with `coding_tasks_list` before starting a real task.

## Lifecycle, turns, slots, and endings

Hosted Pi Lifecycle and Hosted Pi Turn Outcome are separate facts:

- Lifecycle is `launching`, `live`, `ended`, or `interrupted`. A live Hosted Pi retains its durable identity and SDK session.
- A live Hosted Pi has activity `working` while a turn streams or `idle` at its prompt. The compatible v1 task wire projects those activities as `running` and `settled`.
- The last turn outcome is independently `finished`, `failed`, `cancelled`, or `interrupted`. A finished, failed, or cancelled turn normally leaves a persistent Hosted Pi `live` and `idle`; it does not end the session.
- A further prompt steers a working turn rather than starting a second one; while a turn streams the delivery behavior must be stated, and when the session is idle it is ignored.
- **Cancelling** aborts the working turn and returns the same identity to live-idle. The receipt records a cancelled turn outcome, while the SDK session remains attachable.
- **Ending** changes lifecycle to `ended`, disposes the SDK session, and releases its slot. The durable receipt and persisted history remain readable.
- A live Hosted Pi holds a host-cap slot. An idle, unattached Hosted Pi releases its project's overlap lock while still counting against that host-wide cap, and re-acquires the lock when it resumes.
- A Hosted Pi idle and unattached beyond the bounded idle period is ended without replaying its prompt. An operator can end it earlier, so four abandoned identities cannot permanently block the host.
- Steering, cancelling, ending, and reading history from another machine require the Control Credential described in [ADR-0013](../../../runtime/linux/docs/adr/0013-desk-link-carried-hosted-pi-control.md). A host that is not reachable as a Console target keeps working for voice requests.

## Voice control of an existing session

The voice coordinator carries one tool per command: `coding_targets`, `coding_task_start`, `coding_tasks_list`, `coding_task_status`, `coding_task_history`, `coding_task_prompt`, `coding_task_cancel`, and `coding_task_end`. Controlling a session that already exists is the point of the last five: a spoken reference such as the working session on the desk is resolved to a durable task ID through `coding_tasks_list`, and every later call carries that ID with the project, so continuing never creates a replacement identity. [ADR-0014](../../../runtime/linux/docs/adr/0014-hosted-pi-drops-the-edit-and-test-guardrail.md)'s "the voice path reaches the same capability" therefore applies to driving an existing session, not only to starting one; Control Attribution still covers Console-driven sessions only, so a voice-driven turn is not marked with a Console that does not exist.

- `coding_tasks_list` accepts a configured development root as its project and then lists every session recorded under that root, most recently updated first, with its state, lifecycle, activity, last turn outcome and a bounded goal preview. A project scope is a subtree: naming a project also answers for the sessions below it, so one root covers a workspace of subprojects.
- Every other command carries the session's **own** project, exactly as the list reported it. A broader scope resolves a session only in the list; an identity call that reuses the root is refused as an unknown session, which keeps one project from reaching a session under a different one. The daemon reports a project as its real path, so a target whose configured root is itself a symlink still accepts the project the list reported, and the client resolves either form.
- `coding_task_prompt` runs a further turn on an idle session. While the session is working it requires `streamingBehavior` (`steer` or `followUp`); a prompt without one is refused with that reason and the running turn is unaffected. A session that has ended is refused as ended, and one whose launch has not produced a session yet is refused as starting; only a project that does not match is answered as an unknown session.
- `coding_task_history` reads one bounded page of the session's own events, optionally after a physical position an earlier page returned. A session whose launch is in flight has nothing to read yet and is refused as starting; a session that is already over still answers from its persisted log.
- `coding_task_cancel` aborts the working turn and keeps the session attachable; `coding_task_end` disposes the session and releases its slot. Ending a session whose lifecycle is already ended or interrupted is accepted and changes nothing, so a repeat request never rewrites a finished turn, and ending one whose launch is still in flight claims the receipt: a session that then fails to build is disposed rather than rewriting that explicit end as a failure.
- Prompting, steering, cancelling and ending are accepted, not completed. The coordinator states the accepted state and re-reads status or history before claiming progress.
- Only sessions recorded on a configured target are addressable. A Pi someone started in a terminal window on that host is not reachable over this channel and is reported as unaddressable instead of appearing to be steered.
- An unconfigured or empty target list is reported as needing device-local configuration (`ODESK_TASK_TARGETS_FILE` in `voice-agent.env`, and the host's `pi-tasks.json`). The coordinator never invents a host, project, or root to have something to control.
- The voice surface uses the same capability and the same host-side daemon as the Console, without a second session store or a second admission rule: voice reaches a target through that target's own control executable (over SSH only when the target declares a host), a Console reaches the desk over the LAN Control Link under the Control Credential, and the two meet at the daemon's dispatch. Control Attribution is still a Console fact on the desk, where it lives as long as the Console's held connection does; ending a session clears the host record's own `controlledBy` and tells the attached Console with a terminal state, and the desk stops naming it when that Console disconnects.

## Outcomes, positions, and recovery

- A launch receipt contains a durable Hosted Pi identity before execution begins. It is not completion evidence.
- `finished` means one model turn ended normally; `verification: not_run` is not a claim that tests passed. Read the response and session evidence.
- Failed, cancelled, and restart-interrupted turns are distinct. No unknown state is coerced to working.
- Hosted Pi Position is the physical position of a complete entry in the session's append-only log, with zero before the first entry. Non-message log entries can therefore create numeric gaps between visible Session Events; a gap is not lost output.
- History and live events use that same position. History starts strictly after the supplied position, is bounded by physical entries and bytes, and returns an explicit continuation whenever more log entries remain.
- Attach installs the live route before capturing its boundary. Catch-up covers `(after, boundary]`; live delivery then uses positions greater than the boundary. A first attach starts at the current boundary and uses an explicit history request for earlier work.
- On timeout, preserve the target/project/session identity and mutation identity returned in the error and query status. Never create a replacement session or blindly retry a mutation.
- A daemon restart marks every previously launching or working Hosted Pi lifecycle `interrupted`, records an interrupted turn outcome, never replays its prompt, and leaves its persisted session log readable.
- Cancellation is cooperative. A cancel acknowledgement records acceptance; observe the separate activity and turn outcome to know when execution has settled.

Session prompts, responses and Pi session logs are private coding data persisted under `stateDir`. Protect backups and arrange retention explicitly. No automatic deletion or replay policy is implied.

## Acceptance

Automated fixtures validate transport and lifecycle without using model credentials. Production acceptance additionally requires each configured host to list sessions, execute a harmless Chinese read-only request, return a truthful terminal outcome, survive helper disconnect, and cancel a long-running request. A voice acceptance separately verifies that a spoken reference reaches an existing session's own identity: list the target's sessions, read one session's history, prompt it as a further turn, steer a working turn, and end it with its slot released. Test one approved Widget/App change and its verification separately. A Console acceptance separately verifies that a session started from another machine can be attached to, steered mid-turn, cancelled without losing its identity, ended with its slot released, and read back by position after a reconnect. Do not describe templates or fixture tests as deployed two-host support.
