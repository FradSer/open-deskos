# Personal Bot contract

Read [README](../README.md) for installation, STT configuration, the status protocol, and runtime limits.
This file owns authorization, intent routing, Hosted Pi control, proposals, and open acceptance limits.
Read the host deployment runbook before activation or service operations.
Git history preserves past plans and acceptance runs.

The [unified architecture](UNIFIED_ARCHITECTURE.md) defines the five layers and their authority boundaries.

## Plugin composition

[plugin-composition.mjs](../src/plugin-composition.mjs) owns the resident service composition.
The voice service, channel, Agent runtime, home briefing, and optional suggestion watcher use the common Shell plugin host.
Each component has a versioned port and a local factory.
The default Watch manifest uses version 2 and does not require Home.
Home and Watch can stop independently.
Legacy Watch replacements retain their version-1 Home dependency.
Replacement validation preserves each accepted dependency contract.
Task and Remote Pi reading producers have separate versioned ports and runtime dependencies.
These producers read their original owners without generation or Open DeskOS Data requests.

The authenticated management transport also carries `producer_list` and `producer_read`.
These requests require `interface: "odk:producer-projection/v1"`.
They do not change management commands or expose data through runtime diagnosis.
Each producer declares reading identities, labels, fields, and source states.
The Shell adapter registers these declarations through `odk:desk-service-readings/personal-agent/v1`.
The existing Open DeskOS Data registry remains the only data registry.
The adapter retains declaration metadata, not source values.
Each value request reads the current producer and refuses a released producer's late result.
Disabled producers withdraw their declarations at the next service refresh.
Malformed producer inventories do not block healthy producers.
Conflicting reading identities remain unavailable, and the aggregate inventory limit still applies.
The Shell accepts compatible declarations independently after JSON transport.
Failed reads never substitute an earlier live value.
Private memory, model context, owner replies, and action grants remain outside these projections.
Agent configuration failure leaves the resident channel available with the existing configuration report.
Briefing and suggestions require a running Agent.

The local composition exposes `setEnabled(id, enabled)` through the common host lifecycle.
Runtime disable suspends active voice work without closing the service or channel providers.
Runtime restart resumes the service with a new cancellation signal before it publishes the Agent runtime.
Service suspension retains failed recording cleanup and retries it before reopening voice work.
Permanent close prevents later resume operations from reopening the service.
Capture identity guards prevent old recording completion from submitting a later capture.
Partial service, channel, or runtime changes require service methods `suspend` and `resume`.
Older service replacements retain their startup and complete shutdown contracts.
They reject unsupported partial lifecycle changes before the host changes its dependency graph.
The resident provides an independent authenticated plugin management channel.
The unified Plugin CLI selects this channel from its authenticated component identity inventory.
Runtime operations do not change saved startup preferences or the voice protocol.
Service and voice channel changes leave the management channel available for recovery.
Management starts before component initialization and remains available after provider startup failure or saved disable preferences.
Runtime disable cancels cooperative initialization through its existing cancellation signal.
Default Agent initialization passes this signal to model setup and credential availability checks.
Cancellation checks stop later startup stages after pending acquisition settles.
Late session acquisition and failed extension binding abort and dispose the acquired session before initialization rejects.
Session cancellation requests do not establish immediate interruption of SDK extension binding.
The management plugin refuses self-disable and unknown component identities.
Failed lifecycle operations return bounded errors without private component details.

Shutdown cancels the briefing before it waits for suggestion work.
It closes the channel before Agent cancellation.
It closes the voice service before Agent resources.
Successful cleanup operations run once.
Failed cleanup operations remain owned and can retry on a later shutdown request.
Retained consumers prevent provider cleanup.
Cleanup failure does not skip independent resources.
The composition reports cleanup failure after shutdown, so the entry point retains its failed exit status.

Source checkouts and immutable releases load the same Shell kernel.
The composition uses the `personal-agent` host identity.
[Plugin scenarios](../features/plugin-composition.feature) define its startup and shutdown checks.

### Trusted resident development selections

[development-plugins.mjs](../src/development-plugins.mjs) reads explicit startup selections for resident component replacements.
The selection has schema version 1 and a `replacements` array with at most five entries.
Each entry contains `manifest` and an absolute `.cjs` file path named `entry`.
Copy the component manifest from `--plugins list` before you set its replacement version.
The selection file must be regular and contain at most 16 KiB.
Each manifest preserves the component identity, host, kind, provided ports, and required ports.
Current resident components declare no injectable capabilities; replacements must retain an empty permissions list.
The composition rejects duplicate identities and replacements for inactive optional components.
The watcher remains available only when `ODK_PROACTIVE_CONFIG` selects that feature.

Export `create(context)` from each entry.
Return the raw service, channel, Agent runtime, home briefing, or watcher component.
Preserve its existing method contract.
Read the [resident entry point](../src/main.mjs) when implementing runtime replacements; its voice, Home, and watcher factories define required consumers.
Read declared dependencies through `context.get()`.
Register cleanup through `context.onCleanup()` before allocations that can survive factory failure.
The resident adapters retain runtime observers, home attachment, watcher attachment, cancellation, and cleanup order.

This command validates declarations without loading external entries or preparing operational directories:

```sh
node integrations/personal-bot/src/main.mjs \
  --plugin-selection /absolute/path/resident-selection.json \
  --trust-plugins --plugins validate
```

`--plugins list` reports the selected declarations.
Omit `--plugins validate` to start the selected resident composition.
Explicit native trust is required before the selection file is read.
The loader validates every declaration before any external factory initializes.
CommonJS entries load lazily during their selected component initialization.
The loader requires a regular entry file before module loading.
Configuration failure retains the existing resident channel behavior.
Failed feature initialization releases registered resources and leaves independent components running.

Selections refer to explicitly trusted absolute entry paths.
Entries retain native process access and can import other local modules.
The loader uses normal CommonJS module caching within the resident process.
Selections apply to startup and do not provide persistent development links or hot replacement.
Native trust provides no sandbox, signed distribution, immutable revision, update, or rollback guarantee.
Port compatibility still requires shared feature acceptance and device evidence.

### Resident runtime diagnosis

The existing authenticated channel accepts read-only `runtime_diagnose` requests with a bounded `requestId`.
The entry point supplies the current composition catalog.
Responses contain plugin declarations and lifecycle states without private errors, voice replies, readings, or Agent data.
The shared Shell report validator checks identities, host declarations, states, and report bounds.
Asynchronous or invalid snapshots report unavailable without exposing exceptions.

A client requests diagnosis capability with `runtimeDiagnosis: 1` in its existing status request.
The server includes that marker only in status frames for clients that requested it.
Other clients retain their existing status frames.
The Shell sends diagnosis commands only after receiving the marker.
Older residents report unsupported diagnosis without losing their voice connection.
Diagnosis starts no recording or Agent work.

### Hosted Pi task plugins

[task-composition.mjs](../src/task-composition.mjs) owns the task listener, service, and endpoint publisher.
The listener starts before task service initialization.
Endpoint publication follows successful initialization.
An independent authenticated management plugin starts before task components when its local endpoint is available.
The unified Plugin CLI selects Hosted Pi components through their identity inventory.
Management remains available after provider startup failure or saved disable preferences.
Runtime changes do not write startup preferences or change task protocol records.
The management plugin refuses self-disable.
Partial service stop withdraws its endpoint and drains its existing Console connections without closing the listener.
Connection cleanup waits for asynchronous disconnect operations and retains failed operations for retry.
Each connection retains its owning service until disconnect cleanup succeeds.
Restart creates a fresh service and republishes its endpoint through the retained listener.
Older listeners without connection draining reject partial listener and service changes before graph mutation.
Endpoint withdrawal failure retains its service provider and reports lifecycle failure.
Publication failure retains task control and reports the existing warning.
Shutdown withdraws the endpoint before it closes the listener and task service.
Listener cleanup failure does not skip service cleanup.
The host reports shutdown failure after it attempts independent cleanup operations.
Repeated close requests share the current attempt and can retry after failure.
Completed service and endpoint cleanup do not run again.

`createTaskDaemon()` constructs the composition without starting resources.
`startTaskDaemon()` retains the existing start and close interface.
The CLI registers shutdown signals before it starts the plugins.
Late service initialization and publication release their resources after cancellation.
[Task host scenarios](../features/task-host-installation.feature) define these checks.

### Trusted Hosted Pi development selections

Hosted Pi uses the [startup selection format](#trusted-resident-development-selections) through the shared loader.
Its selection accepts at most three replacements: listener, service, and endpoint.
Each declaration retains its Hosted Pi identity, host, kind, provided ports, required ports, and empty permissions list.
Resident identities cannot replace Hosted Pi components.
Current component manifests come from the task daemon's `--plugins list` output.

```sh
node integrations/personal-bot/src/task-daemon.mjs \
  --plugin-selection /absolute/path/hosted-pi-selection.json \
  --trust-plugins --plugins validate
```

Inspection reads declarations without loading task configuration, external entries, listeners, or state directories.
Omit `--plugins validate` to start the selected task daemon.
The default command and task configuration remain unchanged.

Entries export `create(context, bindings)` and return raw components.
The listener receives frozen `handleRequest` and `disconnect` bindings.
It must pass requests and connection identifiers to these callbacks and return a channel with callable `close`.
The host retains task dispatch, startup responses, and runtime diagnosis validation through these callbacks.
The service receives its declared listener through `context.get()`.
It must provide callable `handle`, `disconnect`, and `close` operations.
The endpoint receives frozen `file`, `publish`, `remove`, and `reportPublicationFailure` bindings.
Publication uses the configured descriptor path and existing task configuration.
Return `{ file, published: true, close }` after successful publication.
The returned `file` must match the configured path.
Return `{ file: null, published: false }` when no descriptor is published.
Published endpoints must provide callable `close` that withdraws their descriptor.
Register cleanup before allocations or publication that can survive factory failure.

Selected components with missing operations fail startup before task control is offered.
Registered factory cleanup runs after failed initialization.
Completed cleanup, cancellation, and shutdown order retain the task composition contract.
Startup selections use the same native trust, mutable entry, CommonJS caching, and distribution limits as resident selections.
Real task execution and supported-host acceptance still require separate evidence.

### Hosted Pi task diagnosis

The existing task listener accepts `runtime_diagnose` before dispatching ordinary task commands.
Requests contain only `version: 1`, `command: "runtime_diagnose"`, and a canonical lowercase UUID `requestId`.
Invalid requests return `ok: false` with `invalid-diagnosis-request`.
Successful responses contain `version: 1`, the matching `requestId`, `ok: true`, and `runtime`.
The runtime identifies the `personal-agent` host and the `hosted-pi` instance.
It reports the actual composition catalog, including initialization states.

Invalid catalogs report unavailable diagnosis with `invalid-report`.

The shared runtime validator removes private errors and undeclared metadata.
Reports contain no prompts, task history, endpoint paths, or Agent data.
Task initialization failure retains the existing listener shutdown behavior.
Diagnosis does not extend task service availability or alter ordinary task responses.
[Composition scenarios](../features/plugin-composition.feature) define diagnosis compatibility checks.

## Profiles and memory

Both resident profiles use mandatory typed intent routing and Pi Durable 1.2.0 Code Mode.
Neither profile has TTS.
The coding coordinator has `read`, `grep`, `find`, and `ls` plus reviewed system capabilities.
It has no generic `write`, `edit`, `bash`, or `powershell`, including after resume.
Implementation needs an explicit configured Coding Target and project.
No target means unconfigured; there is no local implementation fallback.
Reviewed custom capabilities have service-user permissions, without an OS sandbox.

The personal profile adds protected memory and explicitly declared reviewed capabilities.
It loads no project instructions, discovered extensions, or operator coding modules.
Set `ODK_PERSONAL_BOT_CONFIG` to a private canonical absolute JSON path:

```json
{
  "profile": "personal",
  "skillPaths": [],
  "memoryFile": "/home/orangepi/.local/state/odk-personal-bot/personal/MEMORY.md",
  "capabilities": {
    "didi": {
      "environment": "sandbox",
      "keyFile": "/home/orangepi/.config/odk/didi.key"
    },
    "browser": {
      "executablePath": "/opt/agent-browser/bin/agent-browser"
    }
  }
}
```

The service user owns the memory parent, mode 0700, and key file, mode 0600.
Windows uses protected user ACLs.
Only operator configuration selects production; sandbox and production keep separate transaction states.
`capabilities` selects only host-reviewed `didi` and `browser` declarations.
[reviewed-capabilities.mjs](../src/reviewed-capabilities.mjs) owns their validation, factories, Skills, intents, workflows, tool prefixes, lifecycle, and `childAllowed` policy.
Legacy top-level `didi` and `browser` keys normalize into that map.
Declaring the same capability in both locations fails validation.
Capability declarations in the `coding` profile fail validation.
Unknown identities and factory paths fail validation.
DiDi configuration includes its built-in Skill.
`skillPaths` adds reviewed absolute `SKILL.md` paths.
`skill_read` returns startup snapshots; a skill adds no scripts, tools, or permissions.
The personal profile needs no writable Git checkout.
Widget/App drafts still need a configured Hosted Pi target and project.
Invalid configuration reports an error instead of ready status.

Memory accepts explicit current-turn commands:

- `记住：我喜欢简短回答`
- `记住 回答偏好：请使用简体中文，简短回答`
- `查看你的记忆`
- `忘记 回答偏好`

A named write replaces that note.
Verbatim current-turn content grants one write.
Private `MEMORY.md` contains an atomic JSON note map, limited to 16 KiB.
Tools expose notes as data, never instructions.
Memory cannot authorize purchases or establish the current pickup point.
Credential detection is heuristic; do not store passwords, tokens, or sensitive account data.
Forget removes a note, not earlier conversation entries.
The operator owns session retention and deletion.

## Ride authorization

Get the full city, actual pickup point, and destination.
Resolve ambiguous places and search both places live.
Obtain a quote and let the user select its product.
Show the route, estimated price, and exact confirmation phrase.
Require `确认叫车 <车型名称> <六位代码>` in a later, separate user turn.
Ordinary punctuation/spacing is tolerated; vague agreement is insufficient.
Only host validation can authorize one submission.
An expired quote or changed route/product requires a new quote and confirmation.
Cancellation requires its own later `确认取消订单 <六位代码>` input.
Follow the [DiDi skill](../src/skills/didi/SKILL.md) for the controlled tool sequence.

Quotes are estimates, not final fares.
Never order from startup, crash recovery, or memory.
The process/state lock rejects a second controller.
Persist transaction intent before mutation.
Unknown delivery blocks another order or cancellation retry.
Retain identity and reconcile through DiDi before manual state repair.
Driver notifications wait while another request is being answered.

The adapter uses the maintained MCP SDK and Streamable HTTP at [DiDi](https://mcp.didichuxing.com/api).
It pins the HTTPS host, disables redirects, and bounds responses/deadlines.
Errors expose no credentials or remote exception bodies.
Text-only status is informational; it cannot establish terminal state or release transaction guards.
Use the DiDi app when structured state is absent.
Payment and unpaid-account handling remain in DiDi's account/app flow.
Never restore transaction state from before a possibly accepted order.

## Intent routing

Every resident owner turn receives a typed intent judgment before turn state, memory reads, suggestion queries, conversation inference, or capabilities.
Touch proposal confirmation also classifies its actual phrase before execution.
No regex shortcut bypasses routing.
The TypeSafe Choice API selects a closed intent; code owns dispatch.
Router state contains unchanged user text, bounded previous-turn context, available tools, and displayed proposal phrases.
Private memory files, credentials, and live readings are excluded.

| Intent | Allowed workflow |
| --- | --- |
| `session_continue` | Resolve the exact existing session or retained remote source reference, then prompt it |
| `task_query` | Read targets, session status, history, and retained remote Pi conclusions |
| `intent_manage` | Create, edit, mute, or read owner-authored natural-language Intents; a wish does not authorize an order |
| `session_control` | Cancel a turn or end a resolved session |
| `coding_work` | Start work on an explicit configured target/project |
| `agent_work` | Admit or continue a general DeskOS child task |
| `agent_identity` | Save or update an explicitly requested child identity |
| `widget_create`, `app_create` | Draft/check; install only when requested |
| `app_query` | Read installed packages and placement |
| `app_manage` | Explicit existing package lifecycle/placement changes |
| `package_query` | Read installed agent packages and named candidates |
| `package_manage` | Apply requested Skill or MCP package lifecycle changes |
| `suggestions` | Read private proposals without conversation inference |
| `proposal_response` | Validate the displayed phrase and subsequent turn |
| `odk_data` | Read current measurements, state, and time |
| `memory` | Apply explicit current-turn remember/forget policy |
| `ride` | Use the reviewed quote/order transaction |
| `browse` | Use the reviewed browser session and requested page actions |
| `extension` | Invoke reviewed capabilities or installed MCP tools |
| `conversation` | Converse without specialized mutations |
| `clarify` | Ask; invoke no downstream model or capability |

Restrict capabilities to the selected workflow at execution time.
The `extension` handler receives registered names and bounded descriptions.
It cannot substitute task, application, proposal, or package lifecycle mutations.
The package-management workflow permits MCP calls only for an explicitly requested connector action.
The [agent package contract](AGENT_CATALOG.md) owns installation, revision, credential, and connector lifecycle rules.
The [child task contract](AGENT_TASKS.md) owns general task execution and saved identities.
After parent admission, the host selects the fixed internal `agent_execute` workflow for that child.
A child creates no Jev client and performs no second intent classification.
Only the composition root can select child execution.
Task text and role guidance cannot select it or expand its tools.
Tool discovery and evidence collection occur during execution; admission does not certify feasibility or completion.
Hosted Pi retains its separate full coding capability.

Register each reviewed capability once as an initially inactive Durable tool.
Activate the current intent's execution allowlist.
The provider transport advertises only `codemode`.
The persisted execution configuration retains active reviewed names for historical direct calls.
Exact historical direct calls use the same parameter validation and executor as nested calls.
Inactive tools cannot be discovered or executed.
Completion, failure, and cancellation deactivate the selected entries.
Startup and failed inference retain no prior intent.
Wrong-entry errors do not authorize wrappers, substitution, replay, or mutation retry.

Reserve identical mutations before execution, once per actual user turn, across both entries.
Canonical argument digests avoid retaining private arguments.
Reject repeats after success, partial side effects, failure, or while pending.
Reviewed `readOnlyHint: true` queries remain repeatable.
Absent hints conservatively mark mutations.
A new explicit turn resets reservations but preserves tool-specific authorization and unknown-outcome gates.
A failed script does not undo completed effects.

Unknown tools and invalid arguments are call errors, not proof of service unavailability.
Historical readings do not establish current conditions.
Raw metrics cannot establish assessments without applicable thresholds or source assessments.

Jev is optional for both profiles, including Overview generation and owner follow-ups.
`ODK_JEV_PROVIDER=disabled` prevents Jev client construction and network requests.
When Jev is unavailable or not configured, the configured ordinary model supplies typed judgments in a separate zero-tool session.
The host validates answer types, intent identifiers, probabilities, and thresholds before it activates capabilities.
Ordinary model confidence is an estimate; it is not calibrated Jev confidence.
Ordinary choice output contains only the selected option and confidence.
The host derives a compatibility distribution; it is not a model-generated or calibrated probability distribution.
A failed optional Jev transport is not retried during the same runtime.
Jev credentials use private `TYPESAFE_API_KEY` or protected `ODK_JEV_KEY_FILE` for the TypeSafe provider.
`ODK_JEV_MODEL` defaults to the selected provider's Jev model and accepts only Jev models.
`ODK_JEV_TIMEOUT_MS` defaults to 10000; allowed range is 1000–30000.
`ODK_JEV_INTENT_THRESHOLD` defaults to 0.8; it must exceed 0.5 and not exceed 1.
Coordinator probability and confidence must both meet the threshold.
Proposals use the separate `ODK_JEV_THRESHOLD` setting.
Thresholds are operating policy, not calibrated accuracy guarantees.
The resident service checks optional Jev once at startup with one fixed public Noul request.
Its independent `jev.status` reports `disabled`, `checking`, `verified`, `missing_credential`, `auth_rejected`, or `unavailable`.
The `judgment` frame reports the active provider and readiness separately.
A valid typed Jev response verifies startup access, regardless of its probability; it does not verify owner intent or future availability.
HTTP 401 or 403 reports rejected access, not a claim that the key is necessarily wrong.
Unavailable reasons distinguish timeout, network, rate limiting, upstream failure, invalid response, request rejection, configuration, and credential access.
Frames contain no credential, key path, or upstream body.
Client reconnects retain the result without another request; service shutdown aborts the check and rejects late results.
Missing Jev credentials do not stop initialization.
Failed ordinary model judgments never fall back to regexes or capability execution.
Ambiguity asks for clarification.
Cancel/close aborts inference and suppresses late results.
Intent selection never replaces confirmation, identity, installation, or unknown-outcome checks.

## Durable runtime

[durable-agent-session.mjs](../src/durable-agent-session.mjs) implements the resident session port through the Pi Durable Harness.
Each profile owns private JSONL state in `<stateDir>/durable/<profile>`.
[durable-storage.mjs](../src/durable-storage.mjs) rejects linked files and holds one writer lease until Harness shutdown.
A stopped process's lease expires after 120 seconds.
All hosts must retain this lease policy.

[durable-legacy-context.mjs](../src/durable-legacy-context.mjs) imports legacy context only into an empty Durable conversation.
It uses the Coding Agent projection, including retained compaction summaries.
It excludes old system messages and normalizes incomplete history through Pi AI.
Import and its checkpoint commit together.
Existing Durable history takes precedence. Later starts do not repeat the import.
Legacy session files remain unchanged.
Imported messages create no submissions, tasks, tools, or authorization.

The coordinator routes each owner request before it resumes pending Durable work.
Answers for clarification, suggestions, or unavailable routing do not resume pending work or prompt the reasoning model.
For requests that need the reasoning model, recovery completes before the new owner turn begins.
Tool admission matches the persisted submission identity against a new host-only request nonce.
The selected intent does not authorize a recovered submission.
Recovered work cannot use a later request's intent, confirmation, or mutation reservations.
Reviewed capabilities retain their argument validation and exact-turn guards.
They use sequential execution and unsafe replay declarations, including capabilities with read-only catalog hints.
An uncertain mutation result does not authorize automatic repetition.

The coding profile uses LocalExecutionEnv for Durable file reads and Pi daemon file inventory.
File searches include hidden paths and exclude `.git` and `node_modules` directories.
Truncated inventories report an incomplete search.
The remaining inspection adapters retain the Coding Agent implementations.
RemoteExecutionEnv construction exists as a tested primitive; resident inspection has no remote execution selector.
Configured remote Pi control continues through the existing authenticated task endpoints.
`createPiSshConnection` connects to an explicitly provisioned daemon through Pi's strict host-key arguments.
It starts SSH with connection-related environment values only.
Provider environment values cannot reach SSH through a configured `SendEnv` pattern.
The operator supplies the daemon command and its target-shell quoting.
This factory accepts no host keys and deploys no daemon.
The caller closes its returned connection.
Read the [SSH acceptance procedure](PERSONAL_AGENT_RESEARCH.md#ssh-acceptance) to verify this transport independently of a device.
Direct SSH task-control targets use the same environment allowlist.
Local control helpers retain their application environment for existing endpoint configuration.

The public session port emits assistant text from committed entries and partial generation views.
Tool results and thinking do not become spoken replies.
Closing a session releases its views, Harness, storage lease, sandbox, and owned environment connection.
Normal isolated generation awaits Harness disposal.
Timeout and cancellation retain their response deadline while cleanup failures remain observed.

<a id="hosted-pi"></a>

## Hosted Pi setup

Read [ADR-0013](../../../runtime/shell/docs/ARCHITECTURE.md#adr-0013) for Control Link ownership.
Read [ADR-0014](../../../runtime/shell/docs/ARCHITECTURE.md#adr-0014) for the coordinator/worker capability decision.

A host daemon owns persistent sessions independently of SSH helpers and voice feedback.
Each host needs Node 22.19+, installed integration dependencies, Pi user authentication, and a trusted writable development directory.
Its file and bash tools have the service account's permissions.
Configured roots govern admission, not every model command.
A Hosted Pi has the same full capability for voice and Console origins.
There is no global second confirmation or edit/test-only worker restriction.
This permits model mistakes to execute with that capability.
Available tools do not authorize unrelated production operations.

Host configuration is private `~/.config/odk/pi-tasks.json`, mode 0600:

```json
{
  "roots": ["/absolute/development/root"],
  "stateDir": "/absolute/private/state/pi-tasks",
  "socketPath": "/absolute/private/run/pi-tasks/control.sock"
}
```

Optional `model` uses `provider/model-id`.
Use a dedicated private socket parent; never a shared system directory.
Pi uses its normal user credential store; this file contains no keys.
The Linux installer stages `systemd/odk-pi-tasks.service` with the stable `/opt/odk/current/integrations/personal-bot` path.
It starts the unit only when configuration exists.
The daemon resolves its entry through the symlink; `--preserve-symlinks-main` is unnecessary.
Mac uses `launchd/com.odk.pi-tasks.plist` with substituted stable installation, Node bin, and home paths.
Validate the substituted plist with `plutil -lint` before authorized loading.
Neither template activates merely by existing.
Keep the daemon separate from the Open DeskOS Link Service so service restarts do not end sessions.
The voice daemon is also independent.
Linux keeps `/opt/odk` read-only.

A fixed executable helper carries one bounded v1 JSON request on stdin and one correlated response:

```sh
#!/bin/sh
export ODK_TASK_CONFIG=/absolute/path/pi-tasks.json
exec /absolute/node/bin/node /absolute/personal-bot/src/task-cli.mjs
```

The daemon must already run.
Never append prompts, projects, passwords, or shell commands to the launcher.
Set `ODK_TASK_TARGETS_FILE` to a private absolute target file in one service configuration source:

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

A unit drop-in overrides `personal-bot.env`; avoid conflicting declarations.
Configure service-user SSH keys and known hosts separately.
SSH uses batch authentication, strict host-key checking, and the fixed executable.
The model selects configured IDs/projects, never arbitrary hosts or executables.
`coding_targets` reports configuration, not connectivity; confirm with `coding_tasks_list` before authorized work.

Windows carries remote POSIX project paths verbatim.
Require an absolute target path without parent segments or control characters.
Never normalize it with local Windows rules.
Windows SSH receives the bounded request through a file on stdin.
Complete on the correlated response frame, then stop the helper process.
Do not wait for helper exit to establish success.

## Hosted Pi tools and lifecycle

Coordinator tools are `coding_targets`, `coding_task_start`, `coding_tasks_list`, `coding_task_status`, and `coding_task_history`.
They also include `coding_task_prompt`, `coding_task_cancel`, and `coding_task_end`.
The completion plugin adds `coding_task_verify` for read-only final-result checks.
The [plugin contract](AGENT_PLUGINS.md#hosted-pi-results) owns its evidence rules and limits.
List accepts a configured project subtree and orders sessions by latest update.
Every identity operation carries the session's own project exactly as listed, plus its durable task ID.
Only the target daemon resolves roots on disk.
A broad list scope does not authorize another project's identity operation.
Terminal-started Pi processes are unaddressable unless they expose a supported endpoint.
Never create a replacement for an existing session merely to continue it.

| Fact | Values and behavior |
| --- | --- |
| Lifecycle | `launching`, `live`, `ended`, `interrupted` |
| Live activity | `working`, `idle`; v1 wire values `running`, `settled` |
| Last turn outcome | `finished`, `failed`, `cancelled`, `interrupted`; independent of lifecycle |
| Prompt | Starts an idle turn; working sessions require `streamingBehavior: steer` or `followUp` |
| Cancel | Aborts the turn; retains the live identity and attachable SDK session |
| End | Disposes the session and releases its host slot; receipt/history remain readable |

An unfinished launch reports starting; an ended identity reports ended.
Do not classify either as unknown project.
End also disables restoration after idle expiry, eviction, or daemon restart.
Repeated End after an explicit End changes nothing.
End during launch claims the receipt and disposes any session created later.
Idle unattached sessions release project overlap locks but still count against the host cap.
Resume reacquires the project lock.
Bounded idle expiry ends the session without prompt replay.
A daemon restart marks launching/working sessions interrupted and keeps their logs readable.
No restart or expiry replays a prompt.
A new owner prompt can restore an expired, evicted, or host-interrupted identity.
Restoration opens the recorded Pi 1.2 session file and sends only the new prompt.
It preserves the task ID, session ID, file prefix, and original goal.
The new mutation receipt precedes restoration, and status reports `launching` during initialization.
Project admission, host capacity, revision checks, and private-path checks still apply.
An explicit End or an unsafe original file prevents restoration.
Restoration requires a canonical private `stateDir`, `sessions` directory, and task directory.
Each directory must use its real path without symlink components.
POSIX directories require the current owner and mode `0700`; Windows directories require the private ACL check.
The host reports directory failures separately from unsafe files and invalid headers.
It never rewrites stored paths or repairs existing permissions.
Cancellation, End, or initialization failure before a new turn preserves the previous turn result.
The optional `lastTurnId` records the host-generated identity of the last terminal execution turn.
The host updates it only when an actual turn finishes; restoration preparation preserves it.
Prompt, steer, cancel, and end receipts show acceptance, not completed work.
Owner-facing replies use natural task names and distinguish accepted, queued, or running work from completed execution.
Exact target, project, task, and mutation identities stay in tool references and internal context.
The coordinator gives raw identifiers only when the owner explicitly requests them.
Unknown outcomes retain those identities for status reconciliation and never authorize automatic retries.
Query status/history before claiming progress.
Console control uses the authenticated Control Link; voice uses the configured helper to the same daemon.
Control Attribution names only a connected Console.
End clears host control ownership; Console disconnect removes desk attribution.

A per-session endpoint can support `list`, `status`, `prompt`, and `cancel` without a host daemon.
Its prompt reports `delivery: ran` when idle or `queued` when working.
Unqueued instructions are refused.
It refuses `start`, `launch`, `end`, and `history` because it is one session, not a host.
Do not start a replacement to bypass that refusal.
An absent endpoint means absent session, not broken desk.
The declared helper resolves projects when several sessions exist.

## Hosted Pi evidence and recovery

Only operator agent-directory settings are trusted.
`noExtensions` alone does not prevent package-resolution installation.
Hosted Pi loads only SDK Code Mode and host check-history factories, without discovered extensions, skills, or templates.
Loader and session settings are separate; reload discards runtime overrides.
Global `cacheWarming: off` disables refresh; the service never rewrites operator policy.
Code Mode scripts have no independent Node, filesystem, network, timer, or auxiliary-model access.
Batch reads; keep mutations sequential under their existing confirmation gates.

A launch receipt establishes identity, not completion.
`finished` means one model turn ended normally.
`verification: not_run` means no independent verifier; inspect actual command evidence separately.
`coding_check` records host-observed process outcome, exit code, and before/after source samples.
Samples include tracked content/deletions, executable modes, symlink text, and nonignored untracked files in the containing repository.
They exclude ignored inputs, external services, and the execution environment.
Matching samples do not provide an immutable checkout or exclude intermediate changes.
Changed/unavailable samples cannot support a same-candidate claim.
Exit zero does not prove adequate tests.
Ordinary `bash` remains available without automatic check metadata.
Later source changes require fresh checks.

Each source sample has two passes sharing five seconds; two samples add approximately ten seconds at most.
Production-workspace sampling performance remains unverified.
Command/cwd identity uses SHA-256 and bounded labels.
Credential redaction is heuristic; raw worker arguments/output can contain secrets.
Session history is private coding data, not a secret vault.
Structured script output is bounded to 64 KiB and omits temporary full-output paths.
Host history preserves bounded nested check output and metadata because Pi omits ordinary nested tool results.
String user prompts remain visible as user events.
Tool events retain tool identities.
Result events retain compact nested-call identities and status without nested arguments.

Hosted Pi Position identifies a complete physical log entry; zero precedes the first entry.
Non-message entries can create numeric gaps without lost output.
History starts strictly after the supplied position and returns bounded pages with explicit continuation.
Escaped JSON budgeting counts both `events` and compatibility alias `entries`.
A single oversized entry is refused with its position.
Reading after that position skips it; disclose the omission instead of claiming complete history.
Attach installs the live route before capturing a boundary.
Catch-up covers `(after, boundary]`; live delivery covers positions above the boundary.
First attach begins at the current boundary; earlier content requires a history request.
Unknown mutations preserve target/project/session/mutation identities for status reconciliation.
Never blindly retry or create a replacement session.
Cancel is cooperative; observe activity/outcome after acknowledgement.
Protect session logs under `stateDir` and arrange retention explicitly.

<a id="proposals"></a>

## Proposal configuration and judgments

The watch reads owner-selected Open DeskOS Data and configured Hosted Pi sessions.
It adds no capture, provider connector, Open DeskOS Data write verb, TTS, wake word, or automatic action.
`ODK_PROACTIVE_CONFIG` selects a reviewed private absolute JSON file without symlink components.
With no file configured, owner suggestions have no polling or proactive model request.
The separate [home briefing](#home-briefing) remains enabled.
Invalid configuration disables suggestions while ordinary voice remains available.
Optional Jev failure does not disable the configured ordinary judgment service.
The file is read once; changes require separately authorized restart.
Concurrent owner edits cause suppression writes to refuse overwrite.

Use [proactive-goals.example.json](proactive-goals.example.json) for version 2.
Owners select goals and bounded observation fields.
An isolated in-memory Durable conversation generates zero or more candidates with the configured model.
It has no tools, Skills, project context, owner memory, execution environment, or persisted transcript.
It loads no operator or project extensions.
`ODK_PROACTIVE_GENERATION_TIMEOUT_MS` defaults to 90000; allowed range is 1000–180000.
The deadline covers the entire generation lifecycle, including at most one format correction.
Provider errors are not retried.
Timeout/cancellation ends waiting even if the provider ignores abort; late-created sessions are disposed.
Agent and watch validate topic IDs, stable semantic keys, bounded text, and host-issued citation IDs.
Invalid or invented evidence leaves generation unavailable.

Each candidate receives independent usefulness, factual-support, and unsupported-assertion judgments through the shared typed judgment service.
Judgment receipts retain the actual `jev-*` or `provider/model` identity across checkpoint reloads.
Ordinary model probabilities are estimates, not calibrated Jev probabilities.
Effective support is `min(factualSupport, 1 - unsupportedAssertion)`.
Usefulness and effective support must both meet `ODK_JEV_THRESHOLD`, default 0.8.
Labels/symbols cannot add attributes; uncited rankings, causes, and aggregates are forbidden.
Owner preferences do not add facts.
Retain supported candidates independently of the presentation limit.
Prioritize owner urgency and scheduled delivery, then deadlines, usefulness, creation time, and stable identity.
Offer at most `maxPush` candidates during one presentation round.
Selecting none is valid.
Generated proposals are read-only: `action: null`.
No inference failure substitutes fixed advice or automatic action.

| Configuration | Bounds/behavior |
| --- | --- |
| `rules` | At most 32 owner-authored rules |
| `pollMs` | 1 second–1 hour; source cache/refresh policy remains authoritative |
| `maxAgeMs` | 1 second–24 hours; invalid/future/stale/unavailable values cannot trigger |
| `cooldownMs` | 1 minute–7 days |
| `goal` | At most 1000 characters |
| `maxCandidates` | 1–16 |
| `maxPush` | 1–`maxCandidates` |
| `generationIntervalMs` | 0–1 hour; default 5 minutes for unchanged semantic inputs |
| `attentionCooldownMs` | 0–1 hour; default 1 minute between automatic presentation rounds |
| `maxGenerationCalls` | 1–16 generation attempts per round; default 4 |
| `observations` | 1–8 selected readings, each with 1–8 dotted fields |
| `liveWhen` | Optional typed `{field, value}` source-availability gate |
| `measuredAtField` | Explicit timestamp field; defaults use package `measured_at` or built-in `asOf` |
| `delivery` | `immediate`, `routine` with `at`, or `silent` |
| `quietHours` | Local `HH:mm` boundaries and optional IANA timezone; overnight works, equal boundaries disable |

Routine delivery occurs at/after its local time once per local day; without quiet-hours timezone, scheduling uses UTC.
Nonurgent proposals queue during quiet hours; owner-marked urgent rules may bypass them.
Silent proposals wait for interaction/query.
Recording or working Spoken Turns defer presentation.
Stable keys and normalized exact advice/evidence reuse pending records.
Fresh observed value changes advance a persistent topic episode, including changes that produce no candidate.
An unchanged episode stays handled after restart; a cleared need can recur with the same values in a later episode.
Unavailable reads and refreshed measurement timestamps do not create episodes.
Only owner-selected observation fields can supply event identity.
Unchanged values reuse generation despite refreshed measurement timestamps.
Rule changes, observation changes, local scheduling boundaries, and approaching deadlines invalidate the generation checkpoint.
Host freshness and delivery checks still run during cached rounds.
Ending ordinary conversation retains automatic quiet-hours and attention limits; explicit suggestions queries use the separate interaction path.
Bounded batches cover eligible sources without a fixed first-source cutoff.
Failed batches isolate their topics across rounds; healthy topics retain their turn within the configured budget.
The judgment service considers overlapping and recent advice; perfect semantic deduplication is not guaranteed.
New source revisions invalidate earlier inference results.
Receipts expose model, trigger, counts, topic/candidate labels, and probabilities, without raw values, generated text, semantic keys, or secrets.
Run `pnpm test:proactive:evaluate` for deterministic offline lifecycle replay.
The report covers silence, generation reuse, checkpoint restart, changed facts, snooze, quiet hours, busy state, and stale sources.
It uses synthetic generation and judgment responses without provider requests or actions.
It does not measure model quality, probability calibration, user benefit, devices, or disk durability.
Failure diagnostics expose fixed codes and scalar assertion differences without source contents or provider errors.

## Legacy proposals and triggers

[proactive-owner.example.json](proactive-owner.example.json) preserves version 1 owner rules.
Its example is a draft, never installed by tests.
Migration expires incompatible pending proposals while retaining processed history and owner suppression.
Conditions select at most eight fields with `lt`, `lte`, `gt`, `gte`, or `eq` and typed values.
Missing fields fail closed; plugin strings/code are never evaluated.
The judgment service decides relevance; exact owner comparisons still gate actions.
Owner-approved advice may only be reordered through an exact sentence-index permutation.
That isolated phrasing session receives no plugin readings and has no tools or durable history.
Invalid phrasing uses approved owner text.
Measurement text comes directly from evidence.

Legacy actions are static reviewed `memory_update`, `user_app_install`, `coding_task_start`, or `coding_task_history` parameters.
Profile availability still applies; plugin fields cannot become parameters.
A proposal never confirms a DiDi order.
Coding rules require an explicit target/project and optional task ID.
An observed working turn or a changed terminal `lastTurnId` establishes completion after a prior session observation.
Startup history, failed/cancelled turns, absent targets, and unreachable services cannot establish completion.
Real launch/prompt receipts track work that finishes between polls.
`verification: not_run` remains unverified.
The suggested history read retains the original target/project/task ID.

There are exactly two judgment triggers: heartbeat and service push.
Heartbeat refreshes owner-selected sources at startup and every `pollMs`.
Authenticated `proactive_event` push carries at most 32 source IDs, never observations or candidate advice.
Coalesce pushes for one second without dropping remaining dependent rules.
Reread authoritative sources and invalidate in-flight results after newer updates.
Credentials, memory, action parameters, and plugin instruction fields never enter proactive judgment state.
Missing/malformed/timed-out judgments report unavailability.
Suggestions queries join existing refresh, then read the private store; they create no third trigger.
Reading advice never accepts its action or substitutes old session tasks.
Disabled, unavailable, and no-pending states remain distinct.

## Proposal state and interaction

Status frames declare `proposalCapabilities` for reading, responding, and presentation acknowledgement.
These flags follow the selected Watch and grant no action authority.
Unsupported displays must retain their own unavailable response controls.

Each proposal retains durable ID, owner rule/subject, state, creation time, advice, action/confirmation, and evidence.
Evidence contains `{readingId, field, value, state, measuredAt, ruleId}`.
`pi-tasks:<target>:<taskId>` marks Hosted Pi evidence.
Heartbeat/push rechecks freshness and relevance; action predicates are rechecked before execution.
Invalid evidence expires the proposal; original measurement times remain visible.
Expired proposals cannot execute.

States are `pending`, `ignored`, `expired`, `executing`, `completed`, and `unknown`.
The store keeps at most 64 full records and 1024 compact handled-occurrence receipts.
Compact receipts retain identity hashes and status without advice or evidence values.
Evict expired records or handled records with saved compact receipts before admitting another full record.
Legacy processed records without occurrence identities retain their original eviction and owner cooldown policy.
Preserve pending/unknown records.
Full unresolved capacity reports its limit and remains available for owner feedback.
Handling an existing suggestion allows generation to retry the deferred need.
Compact receipt capacity stops suggestions without deleting receipts or replaying actions.
Update or remove an obsolete topic and restart to recover capacity.
Compaction removes inactive rule versions; unknown action records remain intact.
POSIX checkpoints use mode 0600 in a 0700 private directory, with file and directory fsync.
Unsafe state disables suggestions instead of clearing receipts.
Windows permits ACL access only to the current user, SYSTEM, and Administrators.
Reject unsafe existing ACLs; never repair them silently.
Protect new directories and an exclusive empty temporary file before writing through its held descriptor.
Windows fsyncs files; directory fsync is POSIX-only.

Reserve `executing` before calling a tool.
Restored executing actions become unknown and block the same rule/subject.
Reconcile through the original tool before operator repair; never retry automatically.
Saved action state must match the current owner rule and cannot grant new authority.
Rule changes expire pending records.
Completed timestamps preserve cooldown even when owner suppression writes fail.
Checkpoint routine offers before sending, preventing repeated daily popups after lost acknowledgement.
Presentation acknowledgements recheck observation freshness before they consume a routine day.
Expired proposals remain unacknowledged.
Checkpoint presentation acknowledgements before owner `routineDays` writes.
Owner-write failure preserves acknowledgement and confirmation.
Explicit queries may reopen acknowledged pending proposals without bypassing confirmation.
Unacknowledged offers can retry presentation when the display consumer reconnects.
Recovery retains freshness, quiet hours, suppression, snooze deadlines, and acknowledged routine days.
Recovery does not consume another offer reservation or repeat generation, judgment, or actions.

The trusted Shell renderer identifies each subscription episode with a UUID.
The client sends this UUID through the optional `proposalConsumerReady` field in its v1 status request.
The connection ignores duplicate requests for its current UUID.
Ordinary status requests and runtime diagnosis do not request recovery.
The service delegates recovery to the selected Watch through optional `consumerReady()`.
Older Watch and client replacements retain their existing contracts without this method.
Hidden views and withdrawn read access clear the renderer episode.
Recovery frames set optional `proposalRecovery: true` and preserve the renderer's Close dismissal.
Readiness requests recovery; only actual viewport visibility establishes presentation.

The panel is nonmodal and preserves focus and direct Shell input.
Provider withdrawal or loss of read access clears suggestion content, controls, and visibility observers.
A late failure from a withdrawn view cannot change replacement feedback.
Use one scrollable surface and `textContent` for untrusted strings.
Back/Close dismisses presentation.
Generated suggestions support Done, Later, Useful, Not relevant, Incorrect, Ignore, and category suppression.
Done records owner feedback without tool execution or a provider-success claim.
Later postpones that candidate; its due reminder retains quiet-hours and category suppression checks.
Generated Ignore, Not relevant, and Incorrect handle one occurrence without muting its topic.
Legacy Ignore writes cooldown; Never suggest this category writes owner suppression.
Neither invokes action tools.
Accept reveals the action and phrase; a separate confirmation sends the exact phrase.
The Shell acknowledges suggestions only after their advice enters the visible scroll viewport.
Disconnected, hidden, and read-only surfaces cannot acknowledge presentation.
Unpresented proposals cannot execute.
`personal_bot_proposal_respond` validates the actual current transcript, never model-supplied authorization.
Feedback requires an explicit current owner response and an unambiguous displayed candidate.
An owner-specified ID must match the tool target.
Memory uses `记住 名称：内容` and its single-use current-turn gate.
Other actions require `确认执行 <proposal-id>`.
Execute sequentially; failure retains unknown state.

Status retains v1 and adds `proposals`, `proposalPopup`, `proposalInteraction`, `proposalHiddenCount`, and optional `proposalError`.
Commands are `proposal_list`, `proposal_presented`, and `proposal_respond`.
Existing filesystem permissions or Windows Channel Token authenticate the connection.
Display payloads fit 48 KB; disclose additional stored proposals.
Proposal replies use an 8192-character bound within the 131072-byte escaped-frame limit.

## Naming migration

Current tool names use `personal_bot`; service/channel names use `personal-bot`; Windows uses `OdkPersonalBot`.
Old `ODK_VOICE_*` settings and `voice-agent.env` are accepted only at upgrade.
Canonical `ODK_PERSONAL_BOT_*` values win.
Move old private state once, retaining checkpoint/history bytes.
Protect Windows ACLs before moving.
Two existing histories or unsafe links fail; never merge them silently.
Retire the old service before activation.
Keep old immutable releases and deployment backups for recovery.

## Open verification and recovery boundaries

The last recorded candidate was `20261003-personal-bot-v6`; Windows used `20261003-v6`.
Both hosts matched all 47 runtime/package SHA-256 values.
Controlled PCM passed CM5 3/3 and Windows 6/6 through real STT, Jev, the configured model, channels, and renderer.
Both hosts restored physical capture configuration.
Windows restored production task actions and removed the temporary test task.
These dated results do not establish current host state.

- Physical speaker-to-microphone playback failed on both hosts. Controlled PCM does not prove owner speech or physical microphone acceptance.
- Physical touch/gamepad, assistive technology, app creation/installation, and Pi continuation remain untested by this acceptance.
- Real ride submission, cancellation, payment, and driver progression remain untested. Development made no real order or charge.
- Sandbox text-only order status could not establish terminal state. Retain identity for DiDi-app reconciliation.
- Real external coding-daemon completion push and authenticated cross-host turns remain unverified.
- The earlier Mac helper was reachable, but its control socket did not answer list. No Mac daemon was installed to conceal that limit.
- Full native Windows suite coverage and production-workspace sampling performance remain unverified.
- Larger actual Windows Widget inputs reached a 30-second generation timeout. Later success does not prove stable latency.
- A configured model produced an unsupported leverage claim that Jev accepted at 0.96. Closed-world checks later rejected it at 0.04.
- Observed-price evidence passed at 0.84; these cases do not prove universal grounding. Sensor values do not prove plant health or historical comparisons.
- Pre-existing Pixel Pi Sessions fill was 13.9%, 17.3%, and 14.9% at 1920×1280, 1920×1080, and 480×854. The 19% floor was unchanged.

A CM5 memory test mistakenly used a production profile because `EnvironmentFile` overrode test settings.
It wrote a named test note to production memory.
The test removed that note and restored the exact original SHA-256.
The final private test environment preserved production memory/configuration hashes.
Check effective environment files and paths before mutation tests; an override alone does not prove isolation.

For v6 recovery, retain the previous CM5 release and Windows task XML/action.
The Windows dependency junction points to the previous release's `node_modules`; retain that directory while referenced.
Keep the physical directory of a running Shell launcher.
Retain protected Jev launchers and check every active dependency pointer before removing artifacts.
Preserve credentials, owner configuration, session logs, and transaction state.
Never roll state back past a possibly accepted order.
The separate `personal-20260917` bundle/service override was superseded; do not recreate it.

Default `pnpm test` is offline; `pnpm typecheck` checks types.
`pnpm test:intents:live` needs explicit provider authorization and private credentials.
It uses synthetic cases and starts no Bot, task, app, order, or service.
Unknown IDs and wrong routes fail.
The proposal harness requires `--live-jev-e2e --runtime-root --personal-bot-root --jev-key --receipt`.
Generated mode adds `--generated-e2e` and repeated `--env-file` options.
Windows uses `.ps1` with `-RuntimeRoot -PersonalBotRoot -JevKey -Receipt` and optional `-GeneratedE2E -EnvFile`.
Use an isolated interactive task; Session 0 is refused.
CM5 requires separate Xvfb/XDG state, not the product display.
Keep raw receipts and credentials private.
A test tool grants no live-run authorization.


## Home selection

A source can declare bounded `home` metadata in its Open DeskOS Data catalog entry.
Installed packages declare the same object in their verified manifest.

```json
{"mode":"optional","priority":0,"icon":"portfolio","fields":["todayChangePercent"]}
```

`mode` accepts `required`, `optional`, and `hidden` for existing manifest compatibility.
Hidden sources do not enter generation.
The other modes have equal selection rights.
The legacy `priority` field accepts integers from 0 to 100 but grants no selection preference.
No source has a reserved display position.
`icon` uses the approved home icon vocabulary.
`fields` selects at most 16 unique top-level value fields.
Package home fields must exist in `data.fields`.
The declaration accepts no prose prompts, arbitrary styles, or execution permissions.
Sources without metadata also participate.
New visible sources need no category-specific Overview registration.

The Agent reads every visible entry returned by the source inventory.
Four readers run concurrently, with a ten-second deadline for each read.
Invalid or oversized values become bounded unavailable or error readings.
A source value can contain at most 64 KiB.
One failed source cannot exclude another source.
Upstream `truncated` and `incomplete` flags identify partial readings.

Pi sources include session counts, goals, current activity, and lifecycle states.
Resident Agent tasks include their goals, running states, results, and verification states.
Remote Pi reports enter through the existing read-only conversation projection.
The adapter reads every retained report page.
Historical reports do not establish current execution.
Reported completion does not establish independently verified completion.
Source adapters do not expose control tokens, private roles, or execution authority.
Futu remains a selectable signed daily percentage, with no mandatory position.

## Home briefing

Personal Agent selects facts from all visible sources and organizes a short Overview.
It shares existing Widget, App, service, and package readers.
It also reads resident Agent task metadata and retained Remote Pi reports.
Source plugins expose these projections through the existing Open DeskOS Data registry.
Overview does not read resident runtime objects directly.
Missing speech credentials or microphone configuration cannot block the Agent or Overview.
Voice input reports its separate configuration failure when requested.

The Agent checks readings every 60 seconds.
An authenticated source push schedules another check after one second.
Agent task and Remote Pi updates also schedule a check.
Measurement timestamps alone do not require another model request.
Ordinary numeric changes bind into the retained template.
Changes to goals, activity, lifecycle states, waiting counts, and attention thresholds require selection again.
Time-sensitive fields also participate in attention checks.
Templates expire after 15 minutes.
The host confirms source identity before publishing pending output.
Pending selections bind to current host fact identities and verification qualifiers.
Changed context schedules another selection without discarding compatible current facts.
Reordered Pi sessions retain their task identities.
Removed or hidden sources cannot supply displayed facts.

Each semantic fact retains its source identity, field references, context, units, and measurement state.
Nested measurements retain their units and enclosing object names.
The selector considers urgency, current work, changes, freshness, repetition, and useful background.
Entity references identify shared tasks across sources without becoming displayed text or control grants.
No source category has a fixed preference.
Previous output supplies presentation history, never instructions.

Each model request contains at most 256 fact candidates and 48,000 bytes.
Larger inputs use separate batches, followed by selection across their candidates.
Every fact reaches its batch before that reduction.
Up to four independent batches run concurrently within one generation deadline.
Each candidate includes its display cost, with separator allowance.
Format corrections identify oversized selections and request fewer facts.
Overview limits each response to 2,048 tokens.
[Model Studio](https://help.aliyun.com/en/model-studio/deep-thinking) requests explicitly disable thinking.
This policy applies only to Overview sessions.
Long facts can supply analysis context without being selectable for display.
Context text above 8,192 characters carries an explicit incomplete flag.
Each request uses a temporary Pi session without tools, extensions, Skills, or memory.
All source content remains untrusted data.

The model returns `{items:[{sources:[0,1]}]}` with integer fact selectors from the captured batch.
The legacy `sources` key now selects facts, not reserved sources.
Each service can supply only one displayed fact across all items.
All of its facts still participate in analysis.
The host keeps the first selected fact for each service identity.
Discarded duplicates cannot enter later selection rounds or invalidate displayed facts.
Selected analysis-only facts receive the same bounded correction as other invalid output.
Correction requests list only displayable choices and retain their original selectors.
The same temporary conversation retains the complete initial analysis context.
Source IDs provide default service identities.
Resident task adapters share `odk.personal-agent`.
Remote report adapters share `odk.app.pi-sessions` with Pi session readings.
Different services remain independent when they use the same icon.
The host compiles their order and grouping into source-bound sentences.
The model cannot supply text, values, references, icons, or formatting.
The output contains at most two items and 240 total characters.
Each item contains at most eight selected facts and eight source IDs.
Unknown selectors, duplicate selections, unsupported formats, and incomplete facts fail validation.

References use `{{sourceId|field.path|format}}`.
Formats are `text`, `number`, `integer`, `celsius`, `percent`, and `signedPercent`.
`@label`, `@state`, and `@availability` bind source metadata.
The host accepts only supplied references and their formats.
Other references bind declared fields from live sources.
Host-owned fact templates retain field meanings and verification qualifiers.
The joined segment text must equal the item text.
The Shell renders safe Markdown and approved icons.
HTML remains literal, images cannot load, and links become display-only text.
Source strings cannot grant instructions or execution authority.

The authenticated status channel carries a separate `briefing` JSONL frame.
The frame contains `v: 1`, `type: "briefing"`, and `briefing`.
A briefing contains `state`, `items`, `generatedAt`, and `omittedSources`.
States are `loading`, `live`, `empty`, `unavailable`, `error`, and `stale`.
`live` identifies successful generation; each source retains its own measurement state.
Older frames remain valid.

The optional `coverage` object contains `totalSources`, `readSources`, `failedSources`, `incompleteSources`, and `selectedSources`.
Failed sources include unavailable and stale readings.
`readSources` counts read attempts, including failures.
Retained items keep their source coverage until replacement facts are ready.
`omittedSources` counts visible inventory entries that could not enter the reading set.
It does not count facts excluded from the short summary.
The paragraph exposes coverage through an accessible description and a pointer tooltip.
It has no attribution footer, measurement timestamp, or source controls.

Generation failure rereads sources and selects complete current facts within the same display budget.
This fallback has an `error` state and a zero success timestamp.
It does not restore a fixed portfolio, weather, and Pi combination.
If current facts cannot be read, retained content remains explicitly stale.
A disconnected Agent also marks retained content stale.
Overview grants no action authority and cannot execute owner proposals.
Touch and keyboard navigation remain independent of generation.

Run `node --test tests/home-briefing.test.mjs tests/home-template.test.mjs tests/agent.test.mjs` for source and generator contracts.
Run the Shell's `tests/agent-home.cjs` for isolated renderer fixtures.
Fixture results do not establish live-model quality or CM5 and Windows device acceptance.

## Remote Pi conversation

`agentPlugins.enabled` can include the fixed `remote_conversation` identity.
This identity requires `completion` and runs only in the resident parent.
It does not load native Pi plugins or grant task control.

The parent reads all connected reporting-machine and session identities through bounded Link pages.
Reporting-machine identity remains separate from configured control targets.
An assistant event is a reported conclusion; activity and tool results are not conclusions.
Missing conclusions remain unavailable.
Cached event tails remain bounded history, including after a reconnect.

An operator can bind one read-only SSH collector with `ODK_PI_SSH_MACHINE`.
This value must match the reporting-machine name.
The existing SSH host, Node path, and collector path remain operator configuration.
The collector accepts its exact executable paths and one `--events=<UUID>` argument through `SSH_ORIGINAL_COMMAND`.
It resolves the session and project from its own process inventory.
Reporting text cannot select an SSH host, file, or command.

Each synthesis uses an ephemeral provider session without tools, Skills, extensions, or memory.
A separate zero-tool reviewer checks report faithfulness, source ownership, and readable assistant updates.
The synthesis returns `updates: [{text, taskName, sourceKeys}]` and the existing `citations` array.
Each batch has one to seven updates, with no more updates than source records.
Each update has at most 600 UTF-16 code units; the batch text limit is 2,000 units.
Each source key belongs to exactly one update.
Related reports for the same task can share an update.
Each message retains only the exact references in its `sourceKeys` list.
The reviewer checks each message against those sources, not only the complete citation list.
Swapped task attribution remains held even when all citations are valid.

The host default is short, natural Simplified Chinese.
Remote source language cannot override that default.
Updates lead with a concrete result, final failure, or evidenced blocker.
They use one or two short paragraphs, with a list only for parallel actionable items.
They omit unsolicited handoff scripts, review inventories, and permission boilerplate.
Material deliverables and evidence boundaries take precedence over brevity.

Each update supplies a nonblank, single-line `taskName` with at most 40 UTF-16 code units.
The name describes work from the assigned sources; it grants no authority.
Source references retain this name across restart.
Later updates reuse suitable stored names or supply reviewed replacements when the work changes.
The current name applies across messages with the same exact session thread.
Startup also names retained tasks in batches of at most seven through separate tool-free generation and review.
This pass changes labels only; it preserves messages, source revisions, replies, and completion watermarks.
Transient naming failures permit at most three attempts per unchanged input.
Rejected names remain held; interrupted read-only naming can resume after restart.
Until naming succeeds, older references use a project label.
Task labels below messages open the exact thread and retain explicit reply selection.

The conversation shows messages without Sources, Conversation details, or Earlier messages disclosures.
Upward scrolling loads retained history and preserves the reading position.
The header hides its status caption when ready and shows Thinking while processing a request.
Delivery uncertainty, stale task updates, and connection failure remain visible.
Technical provenance stays in `remote_pi_updates`, outside the conversation text.
The reviewer rejects even one blanket verification closing sentence.
Updates still explain material task-specific gaps in ordinary language.
They retain useful metrics and file names, but exclude audit identifiers and raw backend details.
They include next steps only when the evidence supports them.
They cannot claim independent verification or promise an action that was not arranged.

Both phases require exactly one citation for each supplied source key.
Their sole format correction states the current source count and keeps the original evidence limits.
A faithful summary can repeat a reported number without a computation receipt.
The generic task completion verifier and its computation requirements remain unchanged.
This check does not verify remote execution, calculations, tests, or task completion.
Reports and summaries remain untrusted conversation data.
They cannot create owner requests or authorize actions.

The private `personal-agent/remote-conversation.json` checkpoint retains source revisions, attempted revisions, pagination, and cited conversation messages.
New messages have `presentation: "assistant_update"` and stable IDs derived from the source batch and message ordinal.
One final checkpoint transaction appends all messages in model order, with their source watermarks and cursor.
The existing snapshot returns newest messages first; clients restore chronological conversation order.
Legacy version 1 messages retain their text, references, and presentation behavior.
Existing held revisions are not cleared or regenerated.
An exact seen revision is not summarized again, including legacy messages without the new presentation marker.
Only a new explicit completed-turn identity can produce another update.
Optional completion watermarks bind the exact source key to its real assistant event ID or Hosted Pi `lastTurnId`.
Retained references can recover those identities; message text never supplies an identity.
Known legacy sources establish a silent baseline when their first current terminal identity becomes available.
Configured sources also support exact retained task revisions and exact legacy reader projections in seen or held records.
The baseline adds a completion watermark without changing old revisions, messages, or held status.
Reported sources require the real persisted assistant entry ID and an explicit terminal outcome.
For reported sources, only an exact seen or held revision reference can restore its previously known identity.
A different older reference cannot identify a newer legacy watermark without an event ID.
A reporter identity upgrade does not itself prove a new completion.
A known latest source watermark takes precedence over older unidentified held records; those records do not absorb new completions.
Collector backfill and reporter replay use the same persisted assistant entry ID without a generated replacement.
An ambiguous result from before migration remains available through manual reads; automatic delivery is not promised.
A live running UUID observed after migration remains reportable when that same turn completes, including after restart.
Unknown or unavailable records cannot establish this evidence.
Sources without legacy history can report their first explicit completion.
Metadata changes alone do not repeat a completed result.
Existing attempts and held revisions remain blocked, including after reconnect or restart.
Existing history expiry rules and current-reference capacity guards still apply.
The service restores these messages into the existing Agent conversation and its current model context.
It retains at most 64 messages and 8,192 source watermarks within a 2 MiB checkpoint.
Byte limits can expire superseded history.
A complete inventory can also permit expiry of disconnected-source history.
Incomplete inventories never permit that expiry.
Current source references and all watermarks remain retained.
Capacity exhaustion with only current sources remains partial or held for review.
The history reports expired-message counts.
A separate bounded remote frame exposes omitted history and source counts without consuming the owner reply frame budget.
`remote_pi_updates` reads further history or one exact source reference.
Failed synthesis holds that revision for review; pushes do not silently retry it.

The resident has no periodic Pi progress timer.
It reads once at startup, after a completion hint, and after a completion subscription reconnects.
Generic Pi reading changes do not request summaries.
The service retains completion hints while busy and drains them when idle.
One hint drains bounded inventory pages while the checkpoint makes progress; a held batch is not regenerated.
Only available terminal results with a nonblank conclusion and an explicit outcome can reach synthesis.
Reported sessions require a stable assistant event ID; configured Hosted Pi tasks require a valid `lastTurnId`.
Active turns, unknown outcomes, unavailable sources, and missing conclusions generate no model call or placeholder.
After a host restart, an explicit retained terminal outcome and `lastTurnId` can support an unreported completion.
An interrupted in-flight outcome cannot support that notification.
A failed or cancelled terminal result remains a report of failure or cancellation, never success.

The internal `subscribe_completions` command opens a read-only Hosted Pi connection for reviewed roots.
The host validates those roots and registers the observer before its acknowledgement.
A completion hint follows the durable turn record and carries bounded identity metadata, not response text.
This connection never attaches a Console or submits a prompt.
One owned helper process per target carries the stream; shutdown joins the local helper or SSH process.
After acknowledgement, the helper emits a fixed fifteen-second transport heartbeat with no task data.
Clients validate and ignore that frame; it never requests inventory or synthesis.
A closed stdout consumer causes the next heartbeat write to abort IPC and clear the timer.
This bound does not guarantee remote process exit during a network partition.
A disconnected stream can reconnect with backoff, but unsupported endpoints have no inventory-poll fallback.
Legacy records without a stable completion identity remain available through manual reads without automatic notifications.
Each collection reads at most four pages, with four sources per page.
A changed batch contains at most seven sources and 128 KiB of input.
Each source read has a 30-second deadline.
Partial inventory and unavailable sources remain visible; they do not prove that no task exists.

An owner follow-up still receives a typed intent judgment before capability execution.
`remote_pi_followup` resolves its source key and revision through the retained host-owned reference.
It carries the configured target, exact project, and task ID without accepting replacement endpoint fields.
An owner can name a displayed task without a reply reference.
Initial classification receives at most 8,192 characters of untrusted displayed task context.
A bounded, distinct session-name index precedes the recent summaries.
The router retains up to six unresolved owner requests, within 8,192 bytes, during this runtime.
A typed choice can join one unexecuted request with its current clarification, preserving both texts.
The host consumes unresolved requests before handler execution, including failed or cancelled attempts.
This context supplies no control authority.
The model selects a retained source key and revision.
The host binds that source to the original owner text.
One owner turn can create only one such reply operation.
Status frames carry a host-generated `ownerTurnId` from the first thinking frame.
An AI-bound reply uses that UUID as its durable reply ID.
The renderer uses this exact identity to retain one owner message and its answer.
The binding callback runs synchronously after persistence and before reply publication.
A failed binding retains a failed record and sends no instruction.
Report-only sources refuse control without that host-bound owner operation.
An explicit reply requires a unique configured machine binding and an exact current session match.
The host checks current task state before sending.
An explicit Hosted reply uses the `list` response only to resolve its session identity.
It sends the current `status` revision to the daemon, which rejects changes before admission.
Native current-session endpoints retain their existing non-atomic status check and unknown-delivery semantics.
The operator can declare `endpointKind: "current_session"` for a verified native target.
An explicit protocol value must agree with that declaration.
An explicit native reply checks current session identity and state.
It does not compare the `list` and `status` object hashes.
A new explicit native owner reply remains a separate mutation when the remote session records an earlier unknown delivery.
The Bot preserves pending delivery locks and all unknown receipts.
Hosted endpoints and other follow-ups still refuse earlier unknown deliveries.
Unknown delivery requires status reconciliation; it never permits automatic replay or a replacement task.
Only a receipt with confirmed admission proves that a task accepted an instruction.
An unknown receipt proves neither admission nor completion.
Follow-up receipts cannot train learned experience.

The CM5 installer maintains `~/.local/bin/odk-pi-task-control` from the reviewed helper template.
The helper follows `RUNTIME_ROOT/current` and defaults to `~/.config/odk/pi-tasks.json`.
An explicit `ODK_TASK_CONFIG` overrides that default.
The Bot unit supplies the same default before operator EnvironmentFiles.
The installer does not rewrite existing target configuration or remove earlier helpers.
After the new helper is verified, the operator must migrate existing executable references with a backed-up, exact configuration update.


### Replies to a Pi conversation message

A text command can include `replyTo: {messageId, sourceKey, sourceRevision}`.
The channel accepts no target, project, or session override in this object.
The resident matches the complete tuple against one retained message source.
A historical message remains usable after a later completion in that session.
An invented revision, missing source, or ambiguous duplicate tuple is refused.

The intent classifier routes the actual owner text with the bound session reference.
The reference supplies context, never action authorization.
During that turn, mutation tools cannot escape to another session or start a replacement task.
Only the bound `remote_pi_followup` can send an admitted continuation.

A configured control target can declare `reportMachines: ["verified-reporting-machine"]`.
The operator verifies that host identity before configuring this binding.
The default empty binding grants no control to report-only sources.
The resident requires complete control inventories and one exact project and session match.
It checks the current task revision again before sending.
Hosted endpoints use their existing revision precondition.
Native endpoints provide a precheck, not an atomic revision guarantee.
Unknown delivery retains its mutation identity and cannot be replayed automatically.

Session threads use the configured target, project, and session identity.
An unmapped report uses its reporting machine instead of a control target.
Revisions, completion text, and timestamps cannot create a thread identity.
Each source exposes a `threadId`; a message exposes one only when all sources share it.
The checkpoint retains at most 128 owner replies in a separate `replies` collection.
Each reply retains its original reference, text, session, thread, admission state, and bounded receipt.
These owner messages are not remote reports or independently verified execution.
Snapshots expose up to 32 recent replies within 24 KiB.
The complete remote frame stays within 60 KiB; pagination and omitted reply counts describe excluded content.
At capacity, only terminal replies outside retained message chains can expire.
The expired reply count remains visible.
Unknown delivery and visible message chains remain preserved.
Capacity refusal preserves the remaining messages and receipts.

On startup, interrupted queued replies become failed, and interrupted dispatching replies become unknown.
The resident saves this recovery once without changing message references, receipts, or existing terminal outcomes.
It does not replay an owner turn or task instruction.
Unknown delivery remains locked across reporting-machine mapping changes.
An unavailable origin reference cannot prove that an unresolved delivery is safe to repeat.
A later completed message can permit a distinct explicit owner request in the same thread.
Both messages must retain different real completion identities for the same configured session.
The later local message timestamp must follow the unknown reply timestamp.
The original source reference must remain available and retain its earlier completion identity.
A changed revision, timestamp, text, or reporting-machine mapping alone cannot release the lock.
The owner must use different text and reply to the later message.
Queued and dispatching requests remain locked.
Admission rechecks the completion boundary before dispatch and immediately before the prompt leaves the resident.
Concurrent dispatch of the same reply remains blocked.
This continuation does not change the earlier unknown receipt or certify its admission.
A subsequent unknown reply requires another later completion before a further owner request.
Every reply requires a nonempty, bounded session identity.
This unreleased format does not support replies without a session identity.
Every reply checkpoint write uses the same reply validator as restart reads.
Invalid checkpoint reads fail without changing the file.
Invalid owner text, answers, or receipts cannot replace the existing checkpoint.
Valid Chinese text, line breaks, and tabs remain supported.

## Provider endpoints

The resident uses one fixed provider resolver for ordinary models and System One requests.
Model selection keeps the existing `ODK_PERSONAL_BOT_MODEL=provider/model-id` format.
`opencode` selects OpenCode Console, also named Zen; `opencode-go` selects the separate Go service.
The runtime hook preserves SDK transports, model limits, compatibility settings, and session headers.
It replaces obsolete catalog endpoints with the selected service's current inference paths.
It does not change non-OpenCode providers.

Console reads `OPENCODE_API_KEY` or the private file `ODK_OPENCODE_KEY_FILE`.
Go reads `OPENCODE_GO_API_KEY` or the private file `ODK_OPENCODE_GO_KEY_FILE`.
An explicit provider key takes precedence over that provider's private file.
Without these values, ordinary models can use an existing SDK API-key credential for the exact selected provider.
The shared SDK ambient `OPENCODE_API_KEY` alias cannot authenticate Go.
The resolver never falls back between Console, Go, and TypeSafe.
Invalid explicit configuration fails without trying another credential.

`ODK_JEV_PROVIDER` selects `typesafe`, `opencode`, or `disabled`.
TypeSafe remains the default and retains `TYPESAFE_API_KEY` and `ODK_JEV_KEY_FILE`.
Console System One uses its explicit Console credential and defaults to `jev-1.13`.
`ODK_JEV_MODEL` can explicitly select another Jev model, including `jev-1.13-free`.
Go cannot supply System One judgments.
Disabled Jev performs no startup authentication request and reports `disabled`, never `verified`.
Provider selection does not change typed answer validation, thresholds, or tool authorization.

Endpoint references: [OpenCode inference API](https://opencode.ai/v2/docs/console/api/inference),
[OpenCode Jev models](https://opencode.ai/v2/docs/console/models/#jev), and
[OpenCode Go](https://opencode.ai/v2/docs/console/go).
