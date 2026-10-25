# DeskOS child tasks

The `subagents` plugin is a fixed DeskOS implementation.
It does not install or load `pi-subagents` or another native Pi extension.
Pi Durable 1.2 owns each child conversation and its tool execution.

## Task lifecycle

The resident returns admission before a child finishes its work.
Each task has an exact UUID handle.
`starting`, `running`, and `cancelling` describe active execution.
`finished`, `failed`, `cancelled`, and `interrupted` describe an inactive turn.

A finished response is separate from completion verification.
The response can have `not_run`, `passed`, or `needs_review` verification.
The completion plugin checks actual tool receipts in a separate session without tools.
Learning requires passed completion checks and excludes admission-only checks.

`agent_start` and `agent_input` receipts prove admission only.
`agent_status` returns the actual response and its separate verification state.
`agent_stop` cancels the exact active task.
Cancellation cannot undo effects that already occurred.
The runtime never replays a task automatically.

Use `agent_input` to continue an inactive task.
A working task refuses another input.
The runtime does not guess between steering and queued delivery.

## Temporary children

A temporary child receives an explicit task and optional role guidance.
Its private home belongs to its task handle.
Its conversation and experience remain separate from the parent and other children.
Continuing the same task reuses that home.
A different temporary task does not reuse it.
The runtime preserves task records without creating a saved identity.

## Saved identities

A saved identity contains an id, display name, role, built-in avatar, and content revision.
Its private home belongs to that identity.
Later tasks and process restarts retain its conversation, explicit notes, and learned experience.
Only one active task can use the same identity.
An admitted task retains the identity revision and role that it selected.

Use `agent_identity_list` to find saved identities.
Use `agent_identity_read` before an update.
Use `agent_identity_save` with the exact `expectedRevision` to update an identity.
Preserve fields that the owner did not request to change.
Starting a task does not create an identity implicitly.

Avatar ids are `agent`, `book`, `code`, `compass`, and `spark`.
They select packaged artwork without an external image URL or executable entry.
The conversation displays the saved name, avatar, and active state.
Unavailable transport changes retained activity to `Status unavailable`.

## Child capabilities

The child receives its task without the parent conversation.
Saved role text supplies bounded task guidance within existing host rules.
It cannot grant permissions or replace the actual task request.

The resident routes the owner's general task through Jev before admission.
The host then selects the fixed internal `agent_execute` workflow for the admitted child.
The child creates no second Jev client and performs no second intent classification.
Task text, saved role text, and model output cannot select this host-only mode.
Execution discovers tools and checks evidence; admission does not establish feasibility or completion.
That workflow can use desk readers, installed MCP tools, and reviewed operator capabilities.
It cannot start another child, change identities, alter packages, or substitute core lifecycle mutations.
The execution workflow retains existing authorization checks.
Each child has separate mutation reservations.

The reviewed registry controls capability inheritance through `childAllowed`.
DiDi is excluded.
An inherited browser uses a separate session under the child's private `stateDir`.
It does not share the parent's browser session.

Children share the installed declarative Skill and MCP catalog with the resident.
Each child owns its MCP connections and closes them after its turn.
Its explicit notes and learned experience use its own home.
Ride transactions and proactive proposal execution are not inherited.
The child cannot load arbitrary Pi packages or extensions.
Repository `.agents/skills/` files guide coding agents and grant no resident or child authority.
The [unified architecture](UNIFIED_ARCHITECTURE.md) separates both Skill audiences.

## Storage and bounds

The registry uses private atomic JSON storage and one filesystem ownership lock.
A second runtime cannot own the same registry concurrently.
Linked, shared, malformed, or oversized state is refused.
The registry preserves existing records when a capacity limit is reached.
It does not prune history automatically.
At capacity, the registry refuses new tasks.
Existing task handles can still receive another turn.
The runtime provides no archive or delete operation.

| Resource | Limit |
| --- | --- |
| Active tasks | 4 |
| Saved identities | 64 |
| Retained task records | 128 |
| Registry file | 4 MiB |
| Task request | 8 KiB |
| Role guidance | 4 KiB |
| Response | 16 KiB |
| Display name | 120 UTF-8 bytes |

A restarted registry marks previously active tasks `interrupted` without dispatching work.
Cancelled or late callbacks cannot establish successful completion.
Storage failure stops new admission and reports incomplete execution.

## Verification

Run the core checks from `integrations/personal-agent`:

```sh
node --test tests/agent-tasks.test.mjs
pnpm typecheck
```

Run integrated resident checks from the runtime integration worktree:

```sh
node --test tests/agent-task-resident.test.mjs
```

The resident tests use actual Durable execution with an offline provider and disposable MCP subprocesses.
They cover admission, isolation, saved identities, completion, learning, and retrieval after restart.
They do not establish live-model quality or a learning benefit.

Run the rendered activity check from `runtime/shell` in an isolated Electron environment:

```sh
pnpm exec electron tests/agent-task-avatars.cjs
```

This check uses synthetic status data without a production service or hardware capture.
It covers four themes, narrow windows, large text, and the fixed composer.
Physical input and deployed-device acceptance remain separate.

Run the complete offline activity pipeline from `runtime/shell`:

```sh
node --test tests/acceptance/agent-task-pipeline.test.cjs
```

The check requires Node.js and both package dependency directories.
It submits tasks through the rendered composer.
Actual Durable execution, service transport, the Main channel plugin, and preload deliver child activity to the conversation.
The check covers reconnect, a new resident process, cancellation, inactive activity removal, and private process cleanup.
The new process must retain the original identity and completed task record.
Negative checks reject missing identities and forced process termination.
The Node test removes the private profile after Electron exits.
Only model responses, intent decisions, and unrelated desk readings use fixtures.
It makes no external model calls and does not establish task quality or physical input.
