# Managed Pi tasks

## Scope

A voice request can start a new Pi SDK task on a configured CM5 or Mac, query its outcome, or cancel it. A host daemon owns the task; terminating an SSH helper or closing voice feedback does not terminate coding. Tasks are not interactive terminal windows and do not take over existing Pi sessions.

Each host needs Node 22.19+, this integration's installed dependencies, Pi authentication under the same non-root user, and a trusted writable development directory. This is a coding harness, not a filesystem sandbox: Pi's file and bash tools have the service account's permissions. Root checks govern task admission, not every command the model could execute.

Default instructions require Chinese replies, project guidance, behavior-first tests, and truthful verification reporting. They prohibit automatic commits, pushes, installation, and deployment. These are agent instructions, not an OS-level command firewall.

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

- Linux: `systemd/open-deskos-pi-tasks.service` → the user's systemd directory. Substitute the integration installation directory and Node bin directory, then enable/start `open-deskos-pi-tasks.service` in that user's session.
- Mac: `launchd/com.open-deskos.pi-tasks.plist` → `~/Library/LaunchAgents/`. Substitute installation directory, Node bin directory and home directory. Validate with `plutil -lint` before loading into the user's launchd domain.

Neither template starts automatically merely because it exists in this repository. The task service is independent of the voice daemon. Linux keeps `/opt/open-deskos` read-only.

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

Configure SSH keys and known hosts for the CM5 voice service user separately. Remote control uses batch authentication, strict host-key checking, and a fixed executable. Prompts travel only as JSON stdin. The model chooses a configured target ID and project, never arbitrary SSH hosts or executable paths.

Restart the voice service after configuration. `coding_targets` describes configured destinations, not proven availability. Confirm each host with `coding_tasks_list` before starting a real task.

## Outcomes and recovery

- A start receipt contains a durable task ID. It does not mean the task completed.
- `running` means the runner still owns execution.
- `finished` means the model run ended normally; `verification: not_run` is not a claim that tests passed. Read the response and session evidence.
- `failed`, `cancelled`, and `interrupted` are distinct outcomes.
- On timeout, preserve the target/project/task ID returned in the error and query status. Never create a replacement task automatically.
- Restarted daemons mark unfinished records interrupted rather than replaying mutations.
- Cancellation is cooperative. Query until the terminal state is available; a cancel acknowledgment alone is not proof all work stopped.

Task prompts, responses and Pi sessions are private coding data persisted under `stateDir`. Protect backups and arrange retention explicitly. No automatic deletion or replay policy is implied.

## Acceptance

Automated fixtures validate transport and lifecycle without using model credentials. Production acceptance additionally requires each configured host to list tasks, execute a harmless Chinese read-only request, return a truthful terminal outcome, survive helper disconnect, and cancel a long-running request. Test one approved Widget/App change and its verification separately. Do not describe templates or fixture tests as deployed two-host support.
