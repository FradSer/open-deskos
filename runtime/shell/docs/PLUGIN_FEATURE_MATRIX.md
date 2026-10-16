# Plugin feature acceptance matrix

## Scope

This matrix maps active product features to their current implementation and acceptance sources.
[PRODUCT](../../../PRODUCT.md) owns product scope.
[CONTEXT](../CONTEXT.md) owns project terms.
[ARCHITECTURE](ARCHITECTURE.md#current-shell-plugin-composition) owns composition boundaries.
[Plugin coverage](PLUGIN_COVERAGE.md) owns recorded verification results and limitations.

A source link identifies existing checks, not a current passing result.
No row certifies complete replacement behavior on all supported hosts.
Preserved P4+C6 research remains outside active product acceptance.

## Acceptance requirements

Each feature needs shared behavior scenarios for its default and selected replacement implementations.
Those scenarios cover normal operation, unavailable dependencies, cancellation, disable, enable, release failure, and recovery where applicable.
Replacement evidence includes actual selection, public consumers, saved state, and resource release.
A minimal alternative must own the responsibility under test instead of delegating it to the default implementation.
An alternative need not use a different internal algorithm or duplicate the complete default implementation.
Startup selection can establish replaceability under the [architecture acceptance contract](ARCHITECTURE.md#replacement-acceptance).
Existing runtime replacement and distribution contracts need their applicable lifecycle, trust, and revision checks.
The rows record unverified evidence, not an ordered implementation checklist.
Each gap must map to an existing feature contract before it becomes required work.
Runtime, distribution, rendering, and device evidence retain their applicable requirements without introducing new capabilities.
Declaration checks alone cannot establish behavior compatibility.

The Shell keeps startup, windows, direct input, Back, and recovery responsibilities.
Feature plugin failures must leave these functions available.
Each supported Shell Host needs separate results.
S3 and P4 need separate physical acceptance.

### Evidence reuse and completion decisions

Use the following decisions when reviewing a gap in this matrix.
These decisions do not certify an implementation or remove an existing acceptance requirement.

| Question | Required evidence | Reuse rule |
| --- | --- | --- |
| Can the feature implementation be selected? | The actual host selects the alternative through its public composition path. | Reuse the host selection fixture; add a feature assertion for the selected responsibility. |
| Does the feature preserve behavior? | Default and selected implementations satisfy the applicable existing feature scenarios. | Reuse scenario inputs and consumer assertions; add checks for uncovered behavior. |
| Does the feature preserve saved state? | Existing data remains readable and existing update, rollback, and recovery operations retain their behavior. | Reuse store and operation scenarios; require migration only where the existing contract requires it. |
| Does the feature release resources? | Its owned subscriptions, requests, processes, and mounted resources follow the applicable lifecycle contract. | Reuse shared lifecycle checks; check feature-specific ownership separately. |
| Does selection preserve trust? | The selected entry uses existing grants, verification, and authority limits. | Reuse shared trust checks; repeat feature checks only for feature-specific authority or activation behavior. |
| Does presentation remain usable? | The selected surface preserves applicable layout, content, focus, and rendering requirements. | Reuse existing geometry inputs and assertions; add comparisons where shared checks do not cover the selected surface. |
| Does the supported host work? | Applicable host and physical acceptance succeeds on the actual target. | Retain separate host results; local fixtures cannot replace device evidence. |

A gap needs a named requirement, current evidence, and an explanation of what that evidence cannot prove.
Do not require every feature to repeat every combination of signing, revisions, themes, sizes, and runtime activation.
Choose combinations from the feature contract and the changed boundary.
Shared checks cannot prove feature behavior that they do not exercise.
Do not add unrelated features to a fixture solely because it already starts the Shell.
Use an existing composition fixture only when it can isolate the affected consumer and report its failure clearly.

For connection and gamepad status, the [evidence assessment](INPUT_STATUS_SURFACE_PLUGIN_CONTRACT.md#evidence-and-limits) distinguishes existing selection checks from complete Main composition.
Their unverified Main activation entry does not independently require a new activation mechanism or another combined fixture.
Require additional checks when existing evidence cannot cover a named wiring or authorization requirement.

## Sources and public consumers

The [Main composition](../src/plugins/main-composition.js) selects Main factories.
The [source declarations](../src/plugins/data-sources.js) connect source instances to IPC and reading consumers.
The [Renderer registry](../src/renderer/core/registry.js) owns surface factories and their mounted resources.
Replacing a source does not establish independent replacement of its Renderer surface.

| Feature | Current plugin owners | Existing acceptance sources | Unverified evidence |
| --- | --- | --- | --- |
| Weather | `odk.source.weather`, `odk.tile.weather` | [Behavior](../tests/features/weather-widget.feature), [parity](../tests/weather-plugin-parity.test.js), [Main bootstrap](../tests/weather-main-bootstrap.test.js), [surface contract](WEATHER_SURFACE_PLUGIN_CONTRACT.md), [rendered surface and shared density](../tests/weather-surface-electron.test.js), [surface revisions](../tests/weather-surface-restart.test.js), [joint Main startup](../tests/weather-main-surface.test.js), [native host investigation](PLUGIN_COVERAGE.md#native-weather-and-weread-investigation) | Pixel evidence; real providers; physical input and display |
| Hydra plants | `odk.source.hydra`, `odk.tile.hydra` | [Behavior](../tests/features/hydra-widget.feature), [parity](../tests/hydra-plugin-parity.test.js), [Main bootstrap](../tests/hydra-main-bootstrap.test.js), [surface contract](HYDRA_SURFACE_PLUGIN_CONTRACT.md), [surface lifecycle](../tests/hydra-surface-lifecycle.test.js), [rendered surface](../tests/hydra-surface-electron.test.js), [surface revisions](../tests/hydra-surface-restart.test.js), [joint Main surface](../tests/hydra-main-surface.test.js), [stylesheet recovery](../tests/renderer-css-recovery.test.js) | Independent density; external broker; supported-host acceptance |
| Camera capture source | `odk.source.camera` | [Source parity](../tests/camera-plugin-parity.test.js), [revisions](../tests/camera-revision.test.js), [Main bootstrap](../tests/camera-main-bootstrap.test.js), [UVC acceptance](../scripts/p4-camera-acceptance.sh), [Main host results](PLUGIN_COVERAGE.md#camera-main-host-acceptance-and-private-windows-channels) | Physical capture and input; Windows Main activation. The Camera Widget surface is retired. |
| Pi sessions and events | `odk.source.pi-sessions`, `odk.source.pi-events`, `odk.tile.pi-sessions`, `odk.app.pi-sessions`, `odk.page.pi-sessions`, `odk.status.pi-sessions` | [Behavior](../tests/features/pi-sessions.feature), [detail and lifecycle scenarios](../tests/features/pi-session-detail.feature), [source parity](../tests/pi-plugin-parity.test.js), [Main source and view revisions and activation](../tests/pi-main-bootstrap.test.js), [App and Page external loading, isolation, and released callbacks](../tests/pi-electron.test.js), [independent Widget](../tests/pi-tile-surface-electron.test.js), [Widget lifecycle](../tests/pi-tile-surface-lifecycle.test.js), [CM5 Widget results](PLUGIN_COVERAGE.md#native-pi-widget-acceptance), [CM5 App, Page, and Main results](PLUGIN_COVERAGE.md#native-pi-app-and-page-acceptance) | Independent density; pixel comparisons; external reporters; remaining Windows consumers; physical input and display |
| Open DeskOS Link readings | `odk.source.odk-link` | [Contract](ODK_LINK_PLUGIN_CONTRACT.md), [shared parity](../tests/odk-link-plugin-parity.test.js), [Main bootstrap](../tests/odk-link-main-bootstrap.test.js), [native source results](PLUGIN_COVERAGE.md#native-odk-link-source-acceptance) | Pi presentation; external reporters; real Hosted Pi control; Windows named-pipe acceptance; physical input |
| Quota | `odk.source.quota`, `odk.page.quota` | [Behavior](../tests/features/quota-design.feature), [parity](../tests/quota-plugin-parity.test.js), [Main source and page](../tests/quota-main-bootstrap.test.js), [surface contract](QUOTA_SURFACE_PLUGIN_CONTRACT.md), [surface replacement](../tests/quota-surface-electron.test.js), [native surface results](PLUGIN_COVERAGE.md#native-quota-surface-acceptance) | Density; real account providers; raster pixels; physical input |
| WeRead | `odk.source.weread`, `odk.tile.weread` | [Behavior](../tests/features/weread-widget.feature), [parity](../tests/weread-plugin-parity.test.js), [revisions](../tests/weread-revision.test.js), [Main bootstrap](../tests/weread-main-bootstrap.test.js), [surface contract](WEREAD_SURFACE_PLUGIN_CONTRACT.md), [rendered surface](../tests/weread-surface-electron.test.js), [surface revisions](../tests/weread-surface-restart.test.js), [joint Main startup](../tests/weread-main-surface.test.js), [native host investigation](PLUGIN_COVERAGE.md#native-weather-and-weread-investigation) | Cover and metadata density; pixel evidence; real provider; physical input and display |
| Futu holdings | `odk.service.futu`, `odk.tile.futu`; Python gateway composition | [Behavior](../tests/features/futu-style.feature), [replacement](../tests/futu-service-replacement.test.js), [Python composition](../../../integrations/futu-poller/poller.py), [native service and Widget results](PLUGIN_COVERAGE.md#native-futu-service-and-widget-acceptance) | Remaining service consumers; actual gateway; Windows service and Widget acceptance; physical interaction |

Read the [Quota contract](QUOTA_SURFACE_PLUGIN_CONTRACT.md#consumer-and-rendering) for the existing meter fill limitation and separate repair scope.
Pi App and Page checks cover ordinary release, delayed responses, and failed Tick cancellation through the current selection paths.
They do not establish arbitrary cleanup-failure recovery.
Any further lifecycle requirement needs a named scenario and an explanation of the gap in those checks.

## System features and external runtimes

The [system declarations](../src/plugins/system-channels.js) own Shell service channels.
The [desk runtime declarations](../src/plugins/desk-runtime.js) own catalog, reading, and installed runtime composition.
Native Shell bundles and installed HTML packages retain separate authority contracts.
[Native plugins](NATIVE_PLUGINS.md) owns signed selection and startup behavior.
[User applications](USER_APPLICATIONS.md) owns installed HTML package behavior.

| Feature | Current implementation owner | Existing acceptance sources | Unverified evidence |
| --- | --- | --- | --- |
| Personal Bot | `odk.system.personal-bot`; [resident composition](../../../integrations/personal-bot/src/plugin-composition.mjs) | [Shell behavior](../tests/features/personal-bot.feature), [composition](../../../integrations/personal-bot/features/plugin-composition.feature), [selected Agent voice, STT, cancellation, and independent Home and Watch consumers](../../../integrations/personal-bot/tests/development-plugins.test.mjs), [selected Home binding and restart](../../../integrations/personal-bot/tests/agent.test.mjs), [selected proactive consumers](../../../integrations/personal-bot/tests/proactive-integration.test.mjs) | Home template formats; remaining generated Watch delivery and recovery; real providers; supported-host management |
| Hosted Pi control | [task composition](../../../integrations/personal-bot/src/task-composition.mjs) | [Task behavior](../../../integrations/personal-bot/features/managed-tasks.feature), [runtime channel](../../../integrations/personal-bot/features/runtime-channel.feature), [selected service connection cleanup](../../../integrations/personal-bot/tests/task-composition.test.mjs), [independent terminal record reader](../../../integrations/personal-bot/tests/task-development-plugins.test.mjs), [selected daemon execution and cancellation](PLUGIN_COVERAGE.md#hosted-pi-external-startup-replacement-verification) | Live SDK session control; Windows daemon control and recovery |
| Remote input | `odk.transport.remote-link`; [Bridge runtime](../../../integrations/remote-bridge/lib/plugin-runtime.js) | [Shell behavior](../tests/features/remote-bridge.feature), [Bridge behavior](../../../integrations/remote-bridge/test/features/remote-bridge-host.feature), [external transport parity and operational selection](../../../integrations/remote-bridge/test/transport-replacement-parity.test.js), [native Bridge results](PLUGIN_COVERAGE.md#native-remote-bridge-transport-acceptance), [native Shell client results](PLUGIN_COVERAGE.md#native-shell-input-and-app-navigation-acceptance) | Physical USB and wireless driver parity; physical handover; complete Shell input integration; Windows acceptance |
| App navigation | `odk.system.app-manager` | [Contract](APP_MANAGER_PLUGIN_CONTRACT.md), [App behavior](../tests/features/app-interiors.feature), [replacement](../tests/app-manager-replacement.test.js), [independent algorithm](../tests/app-manager-independent.test.js), [browser navigation](../tests/app-manager-electron.test.js), [production Main startup and composition](../tests/app-manager-main-bootstrap.test.js), [CM5 Main results](PLUGIN_COVERAGE.md#native-main-management-and-appearance-acceptance), [native browser navigation](PLUGIN_COVERAGE.md#native-shell-input-and-app-navigation-acceptance) | Live-provider composition; physical input; Windows acceptance |
| Open DeskOS Data | `odk.system.data`, `odk.transport.data` | [Behavior](../tests/features/odk-data.feature), [registry and Link replacement](../tests/odk-data-replacement.test.js), [alternative Link](../tests/fixtures/odk-data-link-replacement.js), [native Link results](PLUGIN_COVERAGE.md#native-odk-data-link-acceptance), [selected registry bounds](PLUGIN_COVERAGE.md#native-selected-registry-reading-bounds) | Remaining registry consumer scenarios; live provider integration; full Electron startup |
| Installed Widgets and Apps | `odk.system.package-catalog`, `odk.system.user-apps` | [Store](../tests/features/user-app-store.feature), [runtime](../tests/features/user-app-runtime.feature), [replacement](../tests/user-app-system-replacement.test.js), [native catalog and runtime results](PLUGIN_COVERAGE.md#native-installed-catalog-and-runtime-acceptance) | Remaining Main integration and package interactions; physical interaction; Windows acceptance |
| Renderer shared state | [Services](../src/renderer/core/services.js) | [Selection and ownership](../tests/shared-service-selection.test.js), [Home consumer](../tests/dashboard-lifecycle-electron.test.js), [input consumers](../tests/input-status-surface-electron.test.js), [Quota shared service consumer](../tests/quota-surface-electron.test.js), [Pi briefing consumer](../tests/pi-status-surface-electron.test.js), [preload](../tests/preload.test.js), [CM5 shared service and Home consumer](PLUGIN_COVERAGE.md#native-shared-renderer-service-acceptance) | Windows selected-consumer acceptance; live providers and physical interaction |
| Service refresh and notifications | `odk.system.service-refresh`, `odk.system.service-notifications`, `odk.system.frame-status` | [Refresh behavior](../tests/features/service-plugin-refresh.feature), [independent implementations](../tests/fixtures/service-coordinator-replacements.js), [refresh parity](../tests/service-reading-plugins.test.js), [notification and frame parity](../tests/system-channel-plugins.test.js), [production Main selection](../tests/app-manager-main-bootstrap.test.js), [native coordinator results](PLUGIN_COVERAGE.md#native-service-coordinator-acceptance) | Live providers; Windows coordinator acceptance |
| Appearance | [Appearance Host](../src/renderer/core/appearance-plugins.js) | [Factory checks](../tests/appearance-plugins.test.js), [signed checks](../tests/native-appearance-plugins.test.js), [runtime recovery](../tests/appearance-restoration.test.js), [production Main and installed App](../tests/appearance-main-bootstrap.test.js), [CM5 Main results](PLUGIN_COVERAGE.md#native-main-management-and-appearance-acceptance) | Remaining Appearance consumer scenarios; physical App interaction; Windows acceptance |
| Plugin management and inventory | `odk.system.plugin-control`, `odk.system.plugin-diagnostics` | [Authenticated control](../tests/plugin-control.test.js), [runtime management](../tests/plugin-runtime-management.test.js), [preferences](../tests/plugin-runtime-preferences.test.js), [inventory and health](../tests/plugin-diagnostics.test.js), [selected management and diagnosis in Main](../tests/app-manager-main-bootstrap.test.js), [CM5 Main results](PLUGIN_COVERAGE.md#native-main-management-and-appearance-acceptance) | Windows operator results; physical operation |
| Renderer management, discovery, and inventory | `odk.system.renderer-control`, `odk.system.renderer-development`, `odk.system.renderer-diagnostics` | [Management](../tests/renderer-management.test.js), [control bridge](../tests/renderer-control-bridge.test.js), [discovery and loading](../tests/renderer-development.test.js), [inventory](../tests/renderer-diagnostics.test.js), [selected diagnosis, discovery, and control in Main](../tests/app-manager-main-bootstrap.test.js), [selected control signed activation](../tests/clock-main-bootstrap.test.js), [CM5 Main results](PLUGIN_COVERAGE.md#native-main-management-and-appearance-acceptance) | Windows operator results; physical operation |
| Renderer bridge implementations | `odk.renderer.plugin-control`, `odk.renderer.plugin-diagnostics` | [Trusted replacement interface](AI_PLUGIN_GUIDE.md#renderer-bridge-implementation-replacement), [bridge selection and release](../tests/renderer-bridge-replacement.test.js), [default control behavior](../tests/renderer-control-bridge.test.js), [production CLI activation and recovery](../tests/clock-main-bootstrap.test.js) | Windows bridge acceptance; physical operation |
| External runtime diagnosis | `odk.system.personal-bot-diagnostics`, `odk.system.remote-bridge-diagnostics`, `odk.system.hosted-pi-diagnostics`, `odk.system.futu-runtime-diagnostics` | [Personal Bot](../tests/personal-bot-diagnosis.test.js), [Remote Bridge](../tests/remote-runtime-diagnosis.test.js), [Hosted Pi](../tests/hosted-pi-diagnosis.test.js), [Futu](../tests/futu-runtime-diagnosis.test.js), [shared failure cases](../tests/futu-diagnostic-replacement.test.js), [production Main](../tests/app-manager-main-bootstrap.test.js), [CM5 Main results](PLUGIN_COVERAGE.md#native-main-management-and-appearance-acceptance) | Live external providers; Windows named-pipe and deployed-runtime results |
| S3 Remote | [typed plugin ports](../../../peripherals/esp32-s3-remote/main/remote_plugin_ports.h) | [Behavior](../../../peripherals/esp32-s3-remote/tests/features/remote-control.feature) | Physical driver replacement, touch, display, and USB acceptance |
| P4 camera and microphone | [typed plugin ports](../../../peripherals/esp32-p4-camera/main/p4_plugin_ports.h) | [Behavior](../../../peripherals/esp32-p4-camera/tests/features/p4-camera.feature) | Physical camera, microphone, USB, DMA, and replacement lifecycle acceptance |

The selected Agent checks cover the actual voice service and transcription consumer with synthetic recording and controlled provider responses.
The [resident entry point](../../../integrations/personal-bot/src/main.mjs) also consumes runtime STT configuration, Home generation, and optional proposal generation, phrasing, and execution.
Those consumers retain separate compatibility requirements; voice response and cancellation checks do not certify them.
The selected Home check covers template binding, cached value updates, generation failure and recovery, pending cancellation, and runtime restart through the actual consumer.
The selected proactive check covers owner rule phrasing, exact confirmed memory updates, replay refusal, and owner goal generation through the actual Watch.
It also covers phrasing fallback, generation failure and recovery, and uncertain execution without replay after memory storage recovers.
Runtime disable during generation or phrasing settles pending Watch work, releases the default auxiliary session, and fences late callbacks after enable.
These checks do not certify every Home or proactive scenario.
They replace the Agent runtime while retaining the default Home and Watch implementations.
The existing external Home startup check supplies lifecycle methods without briefing generation, binding, or publication behavior.
Independent Home and Watch component behavior therefore remains separate from Agent consumer compatibility.
The independent Home comparison selects a separate factory and owns its controlled reading acquisition, fact formatting, publication, and scheduling.
Actual service pushes compare live facts, unavailable disclosure, read failure, recovery, disable, and fresh enable.
The pending-read comparison observes provider cancellation, settled refresh, and late completion after a fresh Home starts.
Controlled session and weather readings cover hidden-source exclusion, declared fields, required-source precedence, optional priority, count limits, and omitted-source counts.
The comparison also covers the 8192-byte per-source UTF-8 boundary, required error fallback, and oversized optional-source omission.
Seven required sources exercise the 48000-byte aggregate budget while preserving every required source state.
Undeclared oversized fields remain excluded before budgeting; both implementations retain matching public source metadata and omitted counts.
These extended checks passed locally, on CM5, and on Windows.
This bounded alternative does not establish every template format.
Windows passed the independent Home, selected voice, Home binding, and pending proactive cancellation checks in a private candidate.
The initial confirmed memory check failed because Unix permission checks rejected Windows storage.
Memory now reuses the existing private-file helpers for Windows ACL validation and protected temporary files.
Eight native Windows checks passed, including actual default and selected Agent execution, memory reload, exact grants, and unsafe-file rejection.
The affected CM5 command passed 32 checks and skipped two Windows checks; the local complete Bot suite passed 600 and skipped three.
These results do not establish complete Windows Bot acceptance or live provider behavior.
The independent Watch comparison supplies one owner rule through a separate factory and uses actual service presentation and response commands.
It covers unavailable evidence, matching advice and actions, exact confirmation, replay refusal, resource identities, disable, and fresh enable.
The comparison passed locally, on CM5, and on Windows with controlled execution.
Separate Windows checks passed actual confirmed memory execution through the default and selected Agent.
The extended comparison disables Watch during reading, judgment, or phrasing and observes provider cancellation and settled polling.
After enable, late completion cannot change the new suggestion or publish another service frame.
The extended check passed locally, on CM5, and on Windows with cooperative controlled providers.
Ten owner-rule delivery cases also compare automatic presentation and explicit service-list requests.
They cover silent delivery, quiet hours in UTC and New York, and urgent advice.
Other cases cover routine due times, acknowledged days, snoozing, suppression, and busy recovery.
Repeated polling does not repeat an automatic popup; explicit listing still respects routine due times and acknowledged owner days.
Routine delivery saves its owner day only after presentation acknowledgement; these checks do not execute actions.
Busy state is injected directly through Watch; service voice lifecycle transitions remain separate evidence.
The extended comparison passed locally, on CM5, and on Windows.
The checkpoint comparison uses the actual private proposal store and seeds the selected implementation with a default saved proposal.
The selected Watch reads that checkpoint without migration and retains its identity and presentation acknowledgement after restart.
The confirmed action observes its executing reservation on disk before the controlled execution provider runs.
Completed actions remain completed; interrupted executing records become unknown and cannot replay.
A failed reservation blocks execution and publishes a redacted storage error; recovery reads the saved unexecuted proposal.
Corrupt state refuses Watch initialization without changing the file or stopping peer resources.
The reviewed checkpoint comparison passed locally, on CM5, and on Windows; the native Windows command completed in 160 seconds.
A fresh review finding added acknowledgement assertions before another presentation command; the reviewer confirmed resolution.
Four initialization cases expire saved proposals for changed owner rules, removed or modified actions, and missing judgments.
The comparison captures initialization state before polling, so unavailable readings cannot hide a missing expiry check.
Immediate delivery retries after a lost presentation acknowledgement; routine delivery waits for an explicit service-list request.
Both retain the saved proposal identity; routine acknowledgement records the owner day and suppresses later presentation for that day.
An acknowledged immediate proposal remains available through explicit service-list requests.
These extended cases passed locally, on CM5, and on Windows; the native Windows command completed in 383 seconds.
The evidence-age comparison retains pending proposals at the exact maximum age and expires them one millisecond later.
Actual service listing reports expiry without a popup, and confirmation cannot execute the expired action.
These cases passed locally, on CM5, and on Windows; the native Windows command completed in 382 seconds.
The owner-save failure comparison preserves the saved presentation acknowledgement and proposal identity after restart.
It defers explicit access while busy, then confirms one action and saves its cooldown without replay.
These cases passed locally, on CM5, and on Windows; the native Windows command completed in 469 seconds.
A separate generated Watch comparison owns one owner goal with immediate or silent delivery and shares only the pure batch validator.
It checks unavailable observations, generation failure, invalid citations, forbidden action fields, and a grounding veto.
Valid advice retains probability order, selected evidence fields, stable identities, and no action authority.
Judgment receives the generated marker, owner goal, rule identity, empty criteria, and resolvable evidence references.
The selected implementation reads the default private checkpoint and retains identities and acknowledgement before polling and after restart.
The comparison passed locally, on CM5, and on Windows; the native Windows command completed in 72 seconds.
Four added delivery cases check the push limit, silent delivery, quiet hours, and urgent advice during quiet hours.
Actual service listing reveals queued advice; repeated polling and acknowledged presentation do not repeat automatic popups.
The extended comparison passed locally, on CM5, and on Windows; the native Windows command completed in 240 seconds.
Routine generated delivery, busy state, snoozing, suppression, topic revision changes, coding goals, and remaining failure recovery need separate evidence.

### Hosted Pi execution evidence

The selected daemon service shares the existing task engine and supplies a controlled execution adapter.
CM5 verifies task admission, a persisted running receipt before execution, cancellation during service disable, and refusal to replay after enable.
The independent terminal reader separately owns read-only dispatch for existing finished, failed, cancelled, and interrupted records.
The extended daemon scenario also checks controlled completion, execution failure, terminal receipts, and exact start retries without replay.
Shutdown preserves those terminal records, and final execution counters exclude replay.
The shared engine and controlled adapter do not establish live SDK session control.
A different task algorithm is not required by the [replacement contract](ARCHITECTURE.md#replacement-acceptance).
Further execution checks must preserve the existing task state, receipt, verification, and replay contracts.

## Shared Native resource limits

The [Renderer activation contract](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-signed-renderer-activation) owns published capture lifetime, capacity limits, and retirement restrictions.
Startup replacement acceptance must preserve this contract.
Automatic published retirement is a separate design change that must preserve retained definitions, lazy assets, recovery, and queued operations.
The [shared asset checks](../tests/native-renderer-plugins.test.js) exercise default and selected discovery lease ownership.

## Remaining Renderer surfaces

The [packaged surface directory](../src/renderer/plugins/) also contains these feature owners.
Their registration does not establish independent replacement parity.
The current grouping keeps small display features visible in the completion scope.

| Feature group | Plugin identities | Existing behavior source | Unverified evidence |
| --- | --- | --- | --- |
| Clock tile | `odk.tile.clock` | [Contract](CLOCK_SURFACE_PLUGIN_CONTRACT.md), [scenarios](../tests/features/clock-surface.feature), [browser replacement](../tests/clock-surface-electron.test.js), [production Main activation](../tests/clock-main-bootstrap.test.js), [current CM5 combined results](PLUGIN_COVERAGE.md#native-process-rejection-and-combined-clock-acceptance) | Independent density; real time and timezone transitions; native display and physical input |
| Almanac and Year | `odk.tile.almanac`, `odk.tile.year` | [Contracts](CALENDAR_TIME_SURFACE_PLUGIN_CONTRACT.md), [replacement scenarios](../tests/features/calendar-surface-replacement.feature), [browser checks](../tests/calendar-surface-electron.test.js), [production Main activation](../tests/clock-main-bootstrap.test.js), [current CM5 combined results](PLUGIN_COVERAGE.md#native-process-rejection-and-combined-clock-acceptance), [Calendar density](../tests/features/calendar-density.feature), [native comparison results](PLUGIN_COVERAGE.md#native-calendar-surface-acceptance) | Independent density; native display; live clock progression; physical input |
| State Bar Clock | `odk.status.clock` | [Contract](CALENDAR_TIME_SURFACE_PLUGIN_CONTRACT.md#state-bar-clock), [replacement scenarios](../tests/features/calendar-surface-replacement.feature), [browser checks](../tests/calendar-surface-electron.test.js), [production Main activation](../tests/clock-main-bootstrap.test.js), [current CM5 combined results](PLUGIN_COVERAGE.md#native-process-rejection-and-combined-clock-acceptance), [native comparison results](PLUGIN_COVERAGE.md#native-calendar-surface-acceptance) | Compact State Bar interaction; native display; live clock progression; physical input |
| Pi State Bar | `odk.status.pi-sessions` | [Contract](PI_STATUS_SURFACE_PLUGIN_CONTRACT.md), [replacement scenarios](../tests/features/pi-status-surface-replacement.feature), [registry lifecycle](../tests/pi-status-surface-lifecycle.test.js), [browser replacement](../tests/pi-status-surface-electron.test.js), [native host evidence](PLUGIN_COVERAGE.md#native-pi-state-bar-acceptance) | Authenticated Main activation; joint source replacement; density; raster pixels; physical input and display |
| Pomodoro tile | `odk.tile.pomodoro` | [Contract](POMODORO_SURFACE_PLUGIN_CONTRACT.md), [scenario](../tests/features/desk-tool-surface-replacement.feature), [browser replacement](../tests/desk-tool-surface-electron.test.js), [production Main activation](../tests/clock-main-bootstrap.test.js), [current CM5 combined results](PLUGIN_COVERAGE.md#native-process-rejection-and-combined-clock-acceptance) | Independent density; raster pixels; physical input |
| Pre-order | `odk.tile.preorder` | [Contract](PREORDER_SURFACE_PLUGIN_CONTRACT.md), [replacement scenarios](../tests/features/preorder-surface-replacement.feature), [lifecycle](../tests/preorder-surface-lifecycle.test.js), [canvas replacement](../tests/preorder-surface-electron.test.js), [production Main activation](../tests/clock-main-bootstrap.test.js), [current CM5 combined results](PLUGIN_COVERAGE.md#native-process-rejection-and-combined-clock-acceptance), [composition](../tests/features/e2e-composition.feature), [native host evidence](PLUGIN_COVERAGE.md#native-pre-order-surface-acceptance) | Independent density; GPU presentation; physical input and display |
| Dashboard | `odk.page.dashboard` | [Contract](DASHBOARD_SURFACE_PLUGIN_CONTRACT.md), [Agent Home](../tests/features/agent-home.feature), [lifecycle](../tests/dashboard-lifecycle.test.js), [browser replacement](../tests/dashboard-surface-electron.test.js), [production Main activation](../tests/dashboard-main-bootstrap.test.js), [native host evidence](PLUGIN_COVERAGE.md#native-dashboard-surface-acceptance), [CM5 Main results](PLUGIN_COVERAGE.md#native-dashboard-main-acceptance) | Independent density; live providers; raster pixels; physical input and display |
| Installed Widget placement and App pages | `odk.system.user-app-desktop`; [Renderer adapter](../src/renderer/core/user-app-desktop-plugins.js) | [Contract](INSTALLED_DESKTOP_PLUGIN_CONTRACT.md), [Apps page](../tests/features/user-apps-page.feature), [Host lifecycle](../tests/user-app-desktop-plugins.test.js), [external loading](../tests/user-app-desktop-loading.test.js), [independent behavior](../tests/user-app-desktop-independent.test.js), [actual Shell](../tests/user-app-desktop-plugins-electron.test.js), [production Main startup](../tests/app-manager-main-bootstrap.test.js), [native host evidence](PLUGIN_COVERAGE.md#native-installed-desktop-acceptance) | Density; raster pixels; real catalogs; physical input and display |
| Built-in App views | `odk.app.calendar`, `odk.app.clock`, `odk.app.pomodoro`, `odk.app.year`, `odk.app.app-manager` | [App behavior](../tests/features/app-interiors.feature), [view checks](../tests/app-interiors.test.js), [alternative implementations](../tests/fixtures/builtin-view-replacements.js), [public App replacement](../tests/builtin-view-replacement.test.js), [current CM5 process results](PLUGIN_COVERAGE.md#native-process-rejection-and-combined-clock-acceptance), [native Windows and CM5 acceptance](PLUGIN_COVERAGE.md#native-built-in-app-investigation), [production Main and authenticated activation](../tests/app-manager-main-bootstrap.test.js) | Physical input and screen presentation; Pixel focus visibility and contrast; density |
| Connection and gamepad status | `odk.status.connection`, `odk.status.gamepad` | [Contract](INPUT_STATUS_SURFACE_PLUGIN_CONTRACT.md), [replacement scenarios](../tests/features/input-status-surface-replacement.feature), [registry lifecycle](../tests/input-status-surface-lifecycle.test.js), [browser replacement](../tests/input-status-surface-electron.test.js), [retained state](../tests/gamepad-state-service.test.js), [gamepad](../tests/features/gamepad.feature), [native host evidence](PLUGIN_COVERAGE.md#native-connection-and-gamepad-status-acceptance) | Authenticated Main activation; density; real input; raster pixels and display |

Built-in App checks use the existing public App intent interface.
The Home grid and Built-in views catalog have no App launch controls.
A keyboard launcher is outside current behavior; adding one requires separate feature authorization.
Existing keyboard checks cover Back focus, dialog containment, search, Reload, Escape, and source focus restoration.

The [App Manager contract](APP_MANAGER_PLUGIN_CONTRACT.md#lifecycle-and-acceptance) requires state preservation for compatible runtime replacements.
Hookless legacy implementations retain their existing lifecycle behavior; they do not gain state migration through this audit.

## Additional capabilities outside conversion acceptance

Weather and WeRead currently prove replacement through startup selection and signed revision transitions.
Their surface contracts record runtime hot replacement as unverified, without requiring a new activation path for plugin conversion.
The [installed desktop contract](INSTALLED_DESKTOP_PLUGIN_CONTRACT.md) records runtime management, runtime replacement, and state transfer as unimplemented capabilities.
Those capabilities require separate implementation scope; existing package operations and retained foreground behavior remain required.
Existing App Manager state transfer, authenticated activation, package updates, rollback, and recovery retain their current acceptance requirements.
This distinction does not certify remaining behavior, rendering, provider, or host evidence.

## Verification status

[Plugin coverage](PLUGIN_COVERAGE.md) owns current check results, incomplete commands, and remaining acceptance gates.
This matrix identifies acceptance sources without certifying those checks as currently passing.

## Next implementation priority

Prioritize missing implementation selection and public consumer compatibility before additional runtime or distribution evidence.
Use each feature's existing behavior contract to determine which remaining evidence is required.
Startup selection does not create a requirement for online activation or state migration.
Reuse the [existing replacement boundaries](ARCHITECTURE.md#replacement-acceptance); a gap does not require a new management mechanism.
Reuse shared lifecycle checks; add feature checks for behavior that those shared checks cannot prove.
Record unrelated feature defects separately; plugin conversion must preserve the existing behavior contract.
For each row, identify the missing contract evidence before adding implementation or test infrastructure.
Apply the [evidence reuse decisions](#evidence-reuse-and-completion-decisions) before extending a fixture or adding a new matrix combination.
Close the plugin conversion requirement when selection, applicable behavior, persisted data, public consumers, and resource release are verified.
Keep applicable host acceptance open until verified; additional capability proposals require separate scope.
[Plugin coverage](PLUGIN_COVERAGE.md) owns completed results, composition details, and published resource ownership limits.
Device deployment and live capture require operational authorization.
