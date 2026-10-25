# XFCE desktop agent prototype

This prototype targets an isolated Debian 13 VM with XFCE, X11, and Chrome.
It supports one anonymous shopping fixture task.
It does not support real accounts, payments, production activation, or general desktop automation.

The task finds one 1 metre USB-C cable within the price limit and adds one item to the simulated cart.
The exact goal is `FIXTURE_GOAL` in [the driver](src/driver.mjs).
The request must include `desktopId: "anonymous-chrome"` and one constraint: `fixtureRunId=<current fixture run UUID>`.
A new task requires a fresh fixture with an empty cart and event log.
The same request ID returns its existing task without another admission check.

## Component boundary

The independent worker owns its model calls, screenshots, input loop, and task journal.
QMP supplies the VM framebuffer and sends keyboard and mouse events.
The operator uses an authenticated VNC view during private intervention.
The fixture monitor supplies verification evidence; its DOM state never enters model input.

Pi Durable exposes only these coordinator tools:

- `desktop_task_start`
- `desktop_task_status`
- `desktop_task_result`
- `desktop_task_cancel`
- `desktop_task_resume`

The coordinator receives task handles, status, and bounded result summaries.
It receives no screenshot bytes, input controls, or private intervention tickets.
An admission receipt does not prove completion.
Worker verification remains a reported result until separate evidence supports the requested outcome.
See [the coordinator skill](../personal-agent/src/skills/desktop/SKILL.md).

## Start the worker

Use an ordinary host user.
Keep the configuration file private, with mode `0600` and one link.
Use absolute paths for the configuration file and its filesystem fields.
Keep sockets below `/run/user/<uid>/` in a private directory owned by that user.

The configuration fields are:

| Field | Purpose |
| --- | --- |
| `stateDirectory` | Private task journal, evidence, and operator key directory |
| `rpcSocket` | Private Unix socket for coordinator task requests |
| `qmpSocket` | Operator-configured QEMU monitor socket |
| `vncSocket` | Operator-configured QEMU VNC socket |
| `fixtureEndpoint` | Loopback HTTP endpoint for the anonymous fixture monitor |
| `modelsFile` | Existing operator-owned provider configuration |
| `operatorPort` | Loopback operator port; `0` selects an available port |
| `assetsDirectory` | Local noVNC assets directory |

Run this command from this integration directory:

```sh
node src/main.mjs --config /absolute/private/worker.json
```

The worker reports its operator port and the operator key file path.
Keep the key outside coordinator requests and logs.
The worker selects the configured `gpt-6-luna` model for its visual decisions.
It does not change the online Personal Agent model declaration.
[The entry point](src/main.mjs) owns configuration validation and startup behavior.

Guest provisioning belongs to `scripts/provision-cm5.sh` and `guest/`.
Those components have separate host acceptance requirements.
Their presence does not prove VM installation, acceleration, or device acceptance.
Do not activate a production service from this prototype procedure.

## Private intervention and recovery

Private takeover stops new model observations and invalidates the current execution epoch.
The worker drains pending work and releases input before operator access becomes ready.
Private operator input and pixels do not enter model history or stored screenshot evidence.
Only the authenticated operator interface can authorize private resumption.
Resumption requires the current ticket and revision, followed by a fresh observation.
The coordinator resume tool can resume only an ordinary interrupted task.
It cannot confirm login, MFA, or human verification.

Cancellation drains pending execution and releases input.
It does not undo an action already sent.
Restarted tasks do not automatically replay actions.
A dispatched action without a confirmed result requires independent reconciliation.
A persistence failure isolates the runtime until recovery.
Status and result APIs cannot expose an uncommitted success.
See [the runtime scenarios](features/xfce-agent.feature) and [QMP scenarios](features/qmp-desktop.feature).

## Verification scope

Run local automated checks with:

```sh
pnpm test
```

The [delegation harness](../personal-agent/scripts/test-desktop-delegation-live.mjs) runs the actual Pi Durable harness and Code Mode sandbox.
Its coordinator model is deterministic and synthetic; it makes no paid coordinator model calls.
The independent socket service owns worker inference.
A real worker run needs its own provider, screenshot, action, and fixture verification evidence.
A synthetic coordinator test does not establish worker model capability or production readiness.

The harness accepts `--socket`, `--directory`, `--request`, and `--phase`.
The request argument names a JSON file.
Phases are `start`, `status`, `result`, `cancel`, and `resume`.
Each phase creates a separate private coordinator conversation directory.
Keep actual acceptance reports separate from these operating instructions.

The [device harness](scripts/test-anonymous-loop-live.mjs) tests the fixture, private takeover, cancellation, and pending-decision recovery.
Its default worker uses the configured visual provider.
The explicit `--synthetic-worker` option uses a fixed fixture plan instead.
That option makes no model calls and cannot establish visual model capability.
Use a fresh private output directory for each run.
The harness records public frames and bounded task receipts.
It does not record the private VNC stream.
See [the current handoff](CONTEXT.md) for device status and remaining acceptance work.
