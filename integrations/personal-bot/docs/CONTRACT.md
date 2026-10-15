# Personal Bot contract

Read [README](../README.md) for installation, STT configuration, the status protocol, and runtime limits.
This file owns authorization, intent routing, Hosted Pi control, proposals, and open acceptance limits.
Read the host deployment runbook before activation or service operations.
Git history preserves past plans and acceptance runs.

## Plugin composition

[plugin-composition.mjs](../src/plugin-composition.mjs) owns the resident service composition.
The voice service, channel, Agent runtime, home briefing, and optional suggestion watcher use the common Shell plugin host.
Each component has a versioned port and a local factory.
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

Both resident profiles use mandatory Jev routing and Pi Durable 1.2.0 Code Mode.
Neither profile has TTS.
The coding coordinator has `read`, `grep`, `find`, and `ls` plus reviewed system capabilities.
It has no generic `write`, `edit`, `bash`, or `powershell`, including after resume.
Implementation needs an explicit configured Coding Target and project.
No target means unconfigured; there is no local implementation fallback.
Reviewed custom capabilities have service-user permissions, without an OS sandbox.

The personal profile adds protected memory and reviewed DiDi tools.
It loads no project instructions, discovered extensions, or operator coding modules.
Set `ODK_PERSONAL_BOT_CONFIG` to a private canonical absolute JSON path:

```json
{
  "profile": "personal",
  "skillPaths": [],
  "memoryFile": "/home/orangepi/.local/state/odk-personal-bot/personal/MEMORY.md",
  "didi": {
    "environment": "sandbox",
    "keyFile": "/home/orangepi/.config/odk/didi.key"
  }
}
```

The service user owns the memory parent, mode 0700, and key file, mode 0600.
Windows uses protected user ACLs.
Only operator configuration selects production; sandbox and production keep separate transaction states.
DiDi configuration includes its built-in skill.
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

Every text/transcribed turn reaches Jev before turn state, memory reads, suggestion queries, conversation inference, or capabilities.
Touch proposal confirmation also routes its actual phrase through Jev.
No regex shortcut bypasses routing.
The TypeSafe Choice API selects a closed intent; code owns dispatch.
Router state contains unchanged user text, bounded previous-turn context, available tools, and displayed proposal phrases.
Private memory files, credentials, and live readings are excluded.

| Intent | Allowed workflow |
| --- | --- |
| `session_continue` | Resolve identity and prompt the existing session |
| `task_query` | Read targets, list, status, and history |
| `session_control` | Cancel a turn or end a resolved session |
| `coding_work` | Start work on an explicit configured target/project |
| `widget_create`, `app_create` | Draft/check; install only when requested |
| `app_query` | Read installed packages and placement |
| `app_manage` | Explicit existing package lifecycle/placement changes |
| `suggestions` | Read private proposals without conversation inference |
| `proposal_response` | Validate the displayed phrase and subsequent turn |
| `odk_data` | Read current measurements, state, and time |
| `memory` | Apply explicit current-turn remember/forget policy |
| `ride` | Use the reviewed quote/order transaction |
| `extension` | Invoke reviewed operator-added capabilities |
| `conversation` | Converse without specialized mutations |
| `clarify` | Ask; invoke no downstream model or capability |

Restrict capabilities to the selected workflow at execution time.
The `extension` handler receives registered names and bounded descriptions.
It cannot substitute core mutations; other workflows cannot invoke extension tools.
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

Both profiles require private `TYPESAFE_API_KEY` or protected `ODK_JEV_KEY_FILE`, even with proposals disabled.
`ODK_JEV_MODEL` defaults to `jev-latest` and accepts only Jev models.
`ODK_JEV_TIMEOUT_MS` defaults to 10000; allowed range is 1000–30000.
`ODK_JEV_INTENT_THRESHOLD` defaults to 0.8; it must exceed 0.5 and not exceed 1.
Selected probability and confidence must both meet the threshold.
Proposals use the separate `ODK_JEV_THRESHOLD` setting.
Thresholds are operating policy, not calibrated accuracy guarantees.
Missing credentials stop initialization.
Failed, malformed, or oversized inference never falls back to regexes or Pi routing.
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

The coordinator recovers pending Durable work before routing the next owner request.
Tool admission matches the persisted submission identity against a new host-only request nonce.
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
Repeated End on ended/interrupted sessions changes nothing.
End during launch claims the receipt and disposes any session created later.
Idle unattached sessions release project overlap locks but still count against the host cap.
Resume reacquires the project lock.
Bounded idle expiry ends the session without prompt replay.
A daemon restart marks launching/working sessions interrupted and keeps their logs readable.
Prompt, steer, cancel, and end receipts show acceptance, not completed work.
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
Host history persists nested check metadata because Pi omits ordinary nested tool results.

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
Missing mandatory Jev credentials still blocks Bot startup.
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

Each candidate receives independent Jev usefulness, factual-support, and unsupported-assertion judgments in one request.
Effective support is `min(factualSupport, 1 - unsupportedAssertion)`.
Usefulness and effective support must both meet `ODK_JEV_THRESHOLD`, default 0.8.
Labels/symbols cannot add attributes; uncited rankings, causes, and aggregates are forbidden.
Owner preferences do not add facts.
Sort qualifying candidates by usefulness and select at most `maxPush`.
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
Jev considers overlapping/recent advice; perfect semantic deduplication is not guaranteed.
New source revisions invalidate earlier inference results.
Receipts expose model, trigger, counts, topic/candidate labels, and probabilities, without raw values, generated text, semantic keys, or secrets.

## Legacy proposals and triggers

[proactive-owner.example.json](proactive-owner.example.json) preserves version 1 owner rules.
Its example is a draft, never installed by tests.
Migration expires incompatible pending proposals while retaining processed history and owner suppression.
Conditions select at most eight fields with `lt`, `lte`, `gt`, `gte`, or `eq` and typed values.
Missing fields fail closed; plugin strings/code are never evaluated.
Jev decides relevance; exact owner comparisons still gate actions.
Owner-approved advice may only be reordered through an exact sentence-index permutation.
That isolated phrasing session receives no plugin readings and has no tools or durable history.
Invalid phrasing uses approved owner text.
Measurement text comes directly from evidence.

Legacy actions are static reviewed `memory_update`, `user_app_install`, `coding_task_start`, or `coding_task_history` parameters.
Profile availability still applies; plugin fields cannot become parameters.
A proposal never confirms a DiDi order.
Coding rules require an explicit target/project and optional task ID.
Observe a session working before treating its finished turn as completion.
Startup history, failed/cancelled turns, absent targets, and unreachable services cannot establish completion.
Real launch/prompt receipts track work that finishes between polls.
`verification: not_run` remains unverified.
The suggested history read retains the original target/project/task ID.

There are exactly two judgment triggers: heartbeat and service push.
Heartbeat refreshes owner-selected sources at startup and every `pollMs`.
Authenticated `proactive_event` push carries at most 32 source IDs, never observations or candidate advice.
Coalesce pushes for one second without dropping remaining dependent rules.
Reread authoritative sources and invalidate in-flight results after newer updates.
Credentials, memory, action parameters, and plugin instruction fields never enter Jev state.
Missing/malformed/timed-out judgments report unavailability.
Suggestions queries join existing refresh, then read the private store; they create no third trigger.
Reading advice never accepts its action or substitutes old session tasks.
Disabled, unavailable, and no-pending states remain distinct.

## Proposal state and interaction

Each proposal retains durable ID, owner rule/subject, state, creation time, advice, action/confirmation, and evidence.
Evidence contains `{readingId, field, value, state, measuredAt, ruleId}`.
`pi-tasks:<target>:<taskId>` marks Hosted Pi evidence.
Heartbeat/push rechecks freshness and relevance; action predicates are rechecked before execution.
Invalid evidence expires the proposal; original measurement times remain visible.
Expired proposals cannot execute.

States are `pending`, `ignored`, `expired`, `executing`, `completed`, and `unknown`.
The store keeps at most 64 records and evicts processed history first.
Preserve pending/unknown records.
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
Checkpoint presentation acknowledgements before owner `routineDays` writes.
Owner-write failure preserves acknowledgement and confirmation.
Explicit queries may reopen acknowledged pending proposals without bypassing confirmation.
Unacknowledged immediate offers can retry presentation after restart.
Unacknowledged routine offers remain queryable without repeating the scheduled popup.

The panel is nonmodal and preserves focus and direct Shell input.
Use one scrollable surface and `textContent` for untrusted strings.
Back/Close dismisses presentation.
Ignore writes cooldown; Never suggest this category writes owner suppression.
Neither invokes action tools.
Accept reveals the action and phrase; a separate confirmation sends the exact phrase.
The Shell acknowledges presented IDs; unpresented proposals cannot execute.
`personal_bot_proposal_respond` validates the actual current transcript, never model-supplied authorization.
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
{"mode":"required","priority":100,"icon":"portfolio","fields":["todayChangePercent"]}
```

`mode` is `required`, `optional`, or `hidden`.
`priority` is an integer from 0 to 100.
`icon` uses the approved home icon vocabulary.
`fields` selects at most 16 unique top-level value fields.
The declaration accepts no prose prompts, arbitrary styles, or execution permissions.
Package home fields must exist in `data.fields`.
Existing sources without metadata remain optional.

Hidden sources do not enter generation.
Required sources precede optional sources; optional sources follow priority and relevance.
The input admits optional sources until it has three sources in total.
Additional required sources still enter; optional sources cannot displace them.
Pi home fields include lifecycle counts, not changing activity or transcript text.
Futu holdings sources require only the signed daily percentage.
The home excludes position counts, names, and monetary values.
Live percentage text uses restrained green for gains and red for losses.
Zero and retained percentages use neutral text.
Unavailable required sources must appear with their actual state.
The validator requires its source ID, visible label, and declared icon.
Existing schema correction retries this output within the generation deadline.
At most 16 sources can require coverage within the two-item output.
Oversized required values become bounded error readings instead of disappearing.
Too many required sources fail generation instead of publishing partial coverage.

## Home briefing

Personal Agent generates the first Shell page from the Open DeskOS Data registry.
It reads the same Widget, App, and package sources that answer desk questions.
Home generation starts after Personal Agent initialization.
It does not require an owner suggestion configuration.

The Agent checks readings every 60 seconds.
An authenticated source push schedules another check after one second.
The Agent compares source content before it replaces pending output.
Unchanged source content does not trigger generation within 15 minutes.
Measurement timestamps alone do not count as changed content.
Each generation uses a separate temporary Pi session with no tools, extensions, Skills, or memory.
The session uses the resident Agent model and the existing generation deadline.
Source content is untrusted data and grants no execution authority.

The input includes at most 64 sources, 8 KiB per source, and 48,000 bytes of source data.
The Shell states the omitted source count.
One unavailable source does not remove other readings.
Future mail Apps can publish declared content through Open DeskOS Data without a separate home integration.
This contract does not implement a mail provider.

Resolved display JSON contains at most two connected sentences and 240 total characters.
Each item has `text`, `segments`, and one to eight `readingIds`.
The Agent returns a display template with field references, rather than copied values.
Each segment contains template `text` and an optional approved `icon` name.
References use `{{sourceId|field.path|format}}`.
Formats are `text`, `number`, `integer`, `celsius`, and `signedPercent`.
`@label` and `@state` bind source metadata.
`@availability` reports unavailable when every selected field is absent or null.
The host accepts only the exact supplied references, including their declared formats.
Other paths bind declared fields from live plugin readings.
The host rejects literal facts, unknown fields, uncited sources, and invalid value types.
Literal text permits only bounded connecting words, category nouns, and referenced field names.
Each factual segment requires a plugin field or source-state reference.
The host resolves references before it validates and publishes display text.
Value changes bind into the same template without another model request.
Source availability, declaration, or field-shape changes require a new template.
Templates expire after 15 minutes.
The Shell receives resolved literal text; source strings never become HTML or instructions.
The joined segment text must exactly match the item text.
Context segments connect facts; fact segments have an icon.
The Shell renders one paragraph with subdued context and bright icon-labelled facts.
Source states and measurement times remain available in a native disclosure.
Older frames without segments remain valid, with four items and 600 characters per item.
The host validates these IDs against the current input.
The host adds source labels, states, and measurement times.
Binding establishes field identity and displayed values.
It does not independently certify every connecting phrase generated by the Agent.

The authenticated status channel carries a separate `briefing` JSONL frame.
This frame contains `v: 1`, `type: "briefing"`, and the `briefing` field.
The Shell client combines voice and briefing snapshots after it validates each frame.
Unchanged briefing frames are not repeated with audio levels.
Voice reply limits remain unchanged.
It contains `state`, `items`, `generatedAt`, and `omittedSources`.
Each displayed item contains `text` and `sources`.
Briefing states are `loading`, `live`, `empty`, `unavailable`, `error`, and `stale`.
`live` identifies a completed generation; each source retains its own measurement state.

Failed generation retains previous items with a stale label.
A disconnected Agent also marks retained content stale.
The Shell renders all generated text as literal text.
It never replaces missing output with fixed session-count sentences.
Voice responses and owner proposals remain separate from home content.
Home content cannot accept proposals or execute actions.

Run `node --test tests/home-briefing.test.mjs` for generation and transport contracts.
Run the Shell's `tests/agent-home.cjs` for isolated renderer fixtures.
Fixture results do not establish live-model quality or CM5 and Windows device acceptance.
