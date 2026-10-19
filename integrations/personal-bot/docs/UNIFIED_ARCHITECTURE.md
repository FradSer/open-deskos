# Unified Personal Bot architecture

This document defines five layers for the current runtime candidate.
It separates host facilities, shared product code, resident execution, reviewed capabilities, and task guidance.
The [implementation ledger](PERSONAL_AGENT_IMPLEMENTATION.md) owns verification results and remaining acceptance work.

## Five layers

| Layer | Owner and responsibility | Boundary |
| --- | --- | --- |
| 1. Host tools and state | Host-installed executables, credentials, writable state, and service identity | Host tools stay separate from immutable releases |
| 2. Shared Shell | One Electron Shell for CM5/Linux, Windows x64, and macOS | Platform adapters own host differences; renderer code does not acquire host authority |
| 3. Personal Bot | CM5 resident service with configured intent routing and Pi Durable 1.2 Code Mode | Code owns workflow selection, tool admission, receipts, and recovery |
| 4. Reviewed runtime capabilities | Host-owned descriptors and fixed DeskOS plugin implementations | Configuration selects reviewed identities; it cannot select arbitrary executable factories |
| 5. Skills | Separate runtime guidance and repository coding guidance | Guidance grants no tools, credentials, lifecycle authority, or installation permission |

On CM5, the resident runs as the nonroot `orangepi` user.
Host installation places tools outside the immutable `/opt/odk` release tree.
Private configuration and state belong to the service user.
The writable `ODK_WORKSPACE` checkout remains separate from releases and conversation storage.
A local check cannot authorize deployment, service installation, activation, or rollback.

The Shell presents conversation state and child activity through its existing channels.
Personal Bot remains an external service; its models and tools do not run in renderer code.
CM5 owns inference, transcription, memory, task admission, and the public conversation checkpoint.
Windows runs `display-client.mjs` and retains separate host acceptance.
It exposes the existing authenticated local pipe to its Shell.
A restricted SSH connection carries requests to the CM5 owner socket.
The operator configures the fixed `odk-cm5-agent` alias with a reachable IP and a verified host key.
The dedicated SSH key permits only `hub-stdio.mjs` through a forced command.
It grants no interactive shell or forwarding.
The Windows entry loads no Agent runtime or transcription provider.
The resident entry refuses operational startup on Windows.

Both hosts can capture microphone audio.
CM5 grants one recording lease before Windows starts local capture.
Windows sends bounded, sequenced WAV data; CM5 validates it before transcription.
The same service arbitrates local recording, remote recording, and typed input.
A missing Windows microphone does not prevent text input or display.
A disconnected display retains its draft and reports the connection failure.
Reconnect subscribes to state without replaying text, proposals, or audio.
Both displays receive the same bounded public conversation, task, and briefing projection.
The checkpoint excludes model context, tool records, and private memory.
Interrupted public turns remain unconfirmed after restart.

## Reviewed capabilities

[reviewed-capabilities.mjs](../src/reviewed-capabilities.mjs) owns the fixed capability registry.
Each descriptor owns validation, runtime creation, its Skill, intent criteria, workflow guidance, tool prefixes, lifecycle hooks, and `childAllowed`.
`profile.capabilities` means the `capabilities` map in a personal profile configuration.
Its current reviewed identities are `didi` and `browser`.

[CONTRACT](CONTRACT.md#profiles-and-memory) owns the canonical configuration example and file rules.
Legacy top-level `didi` and `browser` declarations normalize into the canonical map.
Duplicate declarations fail, including a duplicate across legacy and canonical locations.
The `coding` profile rejects capability declarations.
Unknown identities, arbitrary module paths, and model-selected factories are unavailable through this map.

DiDi retains its quote, confirmation, unknown-outcome, and environment boundaries.
Browser page content remains untrusted data and cannot authorize an action.
Each capability retains argument validation and turn-specific authorization.
Creation failure closes resources that have already started.
Shutdown closes each active runtime.

## Resident execution and fixed plugins

The configured judgment provider classifies each owner request before downstream resident execution.
Jev is optional; the configured ordinary model supplies routing when Jev is disabled.
Failure stops dispatch; ambiguity requests clarification.
The selected workflow activates a bounded tool set through `codemode`.
Generic shell and source mutation tools remain outside the resident coordinator.
Hosted Pi handles authorized source work on an explicit target and project.

Explicit notes and learned experience serve different purposes.
Notes retain explicit owner memory commands.
The runtime supplies notes and a bounded experience index as untrusted model context.
`experience_read` retrieves full entries; `experience_list` searches entries omitted from the index.
Neither memory form establishes current evidence or authorization.

The fixed plugin identities are `experience`, `completion`, `learning`, `catalog`, `mcp`, `subagents`, and `intent`.
These identities implement memory retrieval, completion harness checks, procedural learning, packages, connectors, and child execution.
They are DeskOS modules, not native Pi plugin packages.
`learning` requires `completion`; `mcp` requires `catalog`.
[AGENT_PLUGINS](AGENT_PLUGINS.md) owns plugin selection, receipt validation, and persistence rules.

Completion uses a separate session with zero tools and checks actual execution receipts.
A finished response, admission receipt, or model claim cannot prove completed work.
Automatic procedural learning requires passed completion and validated lessons with evidence.
Learning cannot accept an admission-only result as completed work.
Learned procedures remain reference data and require later retrieval and independent evaluation before a benefit claim.

## General tasks and child execution

General tasks enter through resident `agent_work`, then explicit task admission.
The resident returns the exact task handle without waiting for completion.
A later status request reads execution state and separate verification state.
Tasks are limited by available capabilities; “general” does not grant arbitrary host execution.

After admission, the host selects the fixed internal `agent_execute` workflow.
The child creates no second Jev client and performs no second intent classification.
Role text and task text cannot select child mode or expand its tool set.
Children cannot delegate recursively, change identities, alter packages, or invoke core lifecycle mutations.
DiDi is never inherited.
Browser inheritance requires `childAllowed` and a separate browser session under the child's private `stateDir`.

Temporary tasks have separate homes.
Saved identities retain their own conversation, notes, and experience across tasks and restarts.
Only one active task can use a saved identity.
The [child task contract](AGENT_TASKS.md) owns task states, revisions, storage bounds, and cancellation behavior.

The conversation avatar pipeline carries bounded activity through the resident service, Shell client, Main channel plugin, and preload.
The renderer displays saved name, packaged avatar, and actual active state.
Unavailable transport produces an unavailable status rather than an inferred completion.
Rendered activity evidence does not prove physical input or task quality.

## Two Skill audiences

| Audience | Source | Purpose |
| --- | --- | --- |
| Resident and child runtime | Reviewed built-in Skills, configured snapshots, and installed declarative Skills | Guide work within already admitted runtime tools |
| Repository coding agents | `.agents/skills/` and repository instructions | Guide authorized implementation, tests, review, and documentation |

Repository coding Skills never grant resident authority.
A runtime Skill cannot install tools, load scripts, select native Pi extensions, or expand filesystem access.
The catalog installs declarative Skill and MCP revisions only after an explicit request and validated candidate selection.
MCP execution requires current discovery, the installed revision, schema-valid arguments, and the selected workflow.
Connector output remains untrusted data.
[AGENT_CATALOG](AGENT_CATALOG.md) owns package and connector contracts.

The local `pi-packages` source can inform rewritten DeskOS modules.
It is a source reference, not permission to load arbitrary native Pi plugins.
The current runtime candidate source defines implemented behavior.
Historical plans and upstream plugin behavior do not override it.
