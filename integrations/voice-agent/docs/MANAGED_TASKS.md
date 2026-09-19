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

## States, slots, and endings

- A session is `pending`, `running`, `settled` (alive, idle at its prompt), or terminal as `finished`, `failed`, `cancelled`, or `interrupted`.
- A further prompt steers a running turn rather than starting a second one; while a turn is streaming the delivery behavior must be stated, and when the session is idle it is ignored.
- **Cancelling** aborts the running turn and settles the session without disposing it: the identity survives and the session stays attachable.
- **Ending** disposes the session and releases its slot; the terminal receipt stays readable.
- A live session holds a slot. An idle, unattached session releases its project's overlap lock while still counting against the host-wide cap, and re-acquires the lock when it resumes.
- A session idle and unattached beyond the bounded idle period is released without replaying its prompt, and an operator can end it earlier. Four abandoned sessions must never be able to block all further work.
- Steering, cancelling, ending, and reading history from another machine require the Control Credential described in [ADR-0013](../../../runtime/linux/docs/adr/0013-desk-link-carried-hosted-pi-control.md). A host that is not reachable as a Console target keeps working for voice requests.

## Outcomes and recovery

- A start receipt contains a durable session ID. It does not mean the session completed.
- `running` means the runner still owns execution.
- `finished` means the model run ended normally; `verification: not_run` is not a claim that tests passed. Read the response and session evidence.
- `failed`, `cancelled`, and `interrupted` are distinct outcomes, and a cancellation is never reported as a failure.
- On timeout, preserve the target/project/session ID returned in the error and query status. Never create a replacement session automatically.
- Restarted daemons mark unfinished records interrupted rather than replaying mutations. The session's own log remains readable, so a later attach can still show what happened.
- Cancellation is cooperative. Query until the terminal state is available; a cancel acknowledgment alone is not proof all work stopped.

Session prompts, responses and Pi session logs are private coding data persisted under `stateDir`. Protect backups and arrange retention explicitly. No automatic deletion or replay policy is implied.

## Acceptance

Automated fixtures validate transport and lifecycle without using model credentials. Production acceptance additionally requires each configured host to list sessions, execute a harmless Chinese read-only request, return a truthful terminal outcome, survive helper disconnect, and cancel a long-running request. Test one approved Widget/App change and its verification separately. A Console acceptance separately verifies that a session started from another machine can be attached to, steered mid-turn, cancelled without losing its identity, ended with its slot released, and read back by position after a reconnect. Do not describe templates or fixture tests as deployed two-host support.
