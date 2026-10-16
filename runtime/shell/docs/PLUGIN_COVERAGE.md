# Plugin completion coverage

## Scope and status

This audit records checks through 2026-10-12.
The full plugin goal remains unproven.
The Renderer control follow-up added three behavior checks after the complete commands below.
Its VM command passed 115 checks; its production Main command passed 116 checks on macOS and CM5.
Production sources did not change.
All feature designs must use replaceable plugins and preserve existing behavior.
The [final external gates](#final-external-runtime-and-native-host-gates) record current Bot, Bridge, Futu, and native host results.
The latest recorded macOS complete Shell command passed on 2026-10-11: 2260 tests, 2257 passed, zero failed, and three skipped.
The command was `caffeinate -i corepack pnpm@11.22.0 test` from the private candidate's `runtime/shell/` directory.
It exited with status zero in 1097 seconds without timeout or cancellation.
All 1033 captured inputs remained unchanged and matched the local worktree before this report update.
The final local input inventory also matched, and both recorded runner processes had exited.
The candidate and receipts are in `/Users/FradSer/.codex/tmp/odk-mac-full-y2xs4vwl/`.
This command includes the Renderer bridges and the Appearance, Hydra watchdog, and Quota isolation repairs.
The first launch stopped before tests because pnpm refused automatic installation through the shared dependency link.
Its receipt remains in `attempt-1/`; the corrected private environment disables automatic installation with `pnpm_config_verify_deps_before_run=false`.
No candidate input changed between attempts.
Two skips require Windows; the third requires the absent adjacent `pi-packages` checkout.
The latest recorded CM5 complete command passed on 2026-10-11: 2260 tests, 2257 passed, zero failed, and three skipped.
The command was `corepack pnpm@11.22.0 test` from the private candidate's `runtime/shell/` directory.
It exited with status zero in 3051 seconds without timeout or cancellation.
All 1033 captured inputs remained unchanged remotely and matched the local worktree before this report update.
The final local input inventory also matched, and both recorded runner processes had exited.
The candidate was `/home/orangepi/.local/state/odk-acceptance/odk-cm5-2qj2iqxz/candidate`.
Retrieved receipts are in `/Users/FradSer/.codex/tmp/odk-cm5-2qj2iqxz/full/`.
This command includes the Renderer bridges and the Appearance, Hydra watchdog, and Quota isolation repairs.
Two skips require Windows; the third requires the absent adjacent `pi-packages` checkout.
The command used private configuration, state, runtime endpoints, workspace, and Electron profiles.
Separate private copies passed `corepack pnpm@11.22.0 styles` and `corepack pnpm@11.22.0 verify-release` on macOS and CM5.
Both commands completed on 2026-10-12 with status zero, no timeout, and all 1033 captured inputs unchanged.
The checks validated Shell dependencies inside each candidate and hidden startup at 1920 by 1280 pixels.
Existing dependencies were copied into each private Shell directory; no dependency installation or release activation occurred.
The macOS receipts are in `/Users/FradSer/.codex/tmp/odk-mac-release-08sbe4wz/`.
The retrieved CM5 receipts are in `/Users/FradSer/.codex/tmp/odk-cm5-release-bvq3qsbo/`.
The shared control contract check separately passed in the actual adjacent worktrees without skips.
The [contract comparison](../tests/control-contract-fixture.test.js) confirmed byte-identical Desk and Console fixtures.
This supplemental result does not change the complete commands' three recorded skips.
It does not establish physical input, live providers, camera capture, microphone capture, or current Windows acceptance.
The current Windows check reports the handheld offline; its SSH endpoint timed out after Tailscale resumed.
A read-only CM5 check enumerated `303a:7002 Open DeskOS P4 Camera and Microphone` and `/dev/odk-p4-camera`.
This establishes USB enumeration only; the candidate P4 firmware remains unflashed, and no image or audio was captured.
Earlier macOS temporary receipts are unavailable; the current complete command has retained receipts.
Read [Renderer bridge replacement](#renderer-bridge-programmatic-replacement) for its evidence limits.
The two Windows skips require named pipe authentication and PowerShell microphone-name encoding.
Both cases previously passed on Windows through private inputs without starting product services or recording audio.
The [channel check](../tests/local-channel.test.js) and [launcher check](../tests/personal-bot-launcher-windows.test.js) define those requirements.

The latest complete command includes all nine Clock, Quota, and Pi State Bar test and scenario changes after the preceding successful command.
Clock negative guards now require deliberate failure exits instead of matching text from killed children.
The CM5 Clock follow-up passed all twelve checks; its local follow-up also passed twelve checks in 69557 milliseconds.
The [Quota shared service follow-up](#quota-shared-service-follow-up) passed fifty checks locally and on CM5.
The [Pi briefing follow-up](#pi-briefing-service-follow-up) passed 63 checks locally and on CM5.
Production sources did not change during these verification increments.

The preceding complete attempt reported 2244 tests: 2234 passed, seven failed, one was cancelled, and two skipped.
All 673 captured inputs and its final inventory remained unchanged; that command exited with status one.
Diagnosis exceeded its parent deadline, and Appearance installation reported verification timeout.
Built-in views, both calendar modes, both Camera Main modes, and combined Clock reported completion before their children exceeded watchdog deadlines.
Printed completion does not establish successful process termination.
The subsequent affected rerun passed 113 checks with all 676 captured inputs unchanged.
All former failing children exited normally in that focused rerun.
The latest successful complete run clears that earlier local gate for its captured candidate.
It does not establish the causes of all earlier failures.

The [Pi Widget command](#native-pi-widget-acceptance) passed all 96 affected checks locally and on CM5.
The [Pi view command](#native-pi-app-and-page-acceptance) passed all 90 affected checks locally and on CM5.
The [Main management and Appearance command](#native-main-management-and-appearance-acceptance) passed all 95 affected checks locally and on CM5.
The [native Camera result](#native-camera-surface-fixture-acceptance) records eight passing checks on each supported device host.
The [current fixture results](#native-process-rejection-and-combined-clock-acceptance) record stricter process rejection and the combined Clock comparison on CM5.
The [feature matrix](PLUGIN_FEATURE_MATRIX.md) identifies feature owners and remaining acceptance gaps.
Supported-device acceptance still needs its applicable checks.
Read-only host inspection on 2026-10-10 reached CM5 at active release `20261004-connection-fixes-v2`.
That release has no `src/plugin-host.js`.
The initial service check addressed the SSH user's service manager; it did not establish the `orangepi` service state.
This inspection does not establish current-candidate behavior or graphical acceptance.
The recorded Windows handheld domain did not resolve; its recorded Tailscale and LAN SSH addresses timed out.
No deployment, activation, service change, or capture occurred during these inspections.
A fresh private candidate passed runtime composition validation, Shell dependency validation inside Electron, and launcher smoke on 2026-10-10.
Those candidate checks preceded the later Futu cleanup changes and do not certify the current source tree.
It contains the Shell, Personal Bot, and Remote Bridge with copied dependencies and valid release metadata.
All 898 captured source files remained unchanged during these checks.
The candidate excludes local environment files and credentials; smoke uses private configuration, state, workspace, and Electron profile directories.
`bash run.sh --smoke --user-data-dir=<private-profile>` reported `ok:true`, width 1920, and height 1280.
Seven actual Personal Bot dependency entry imports passed; its dependency links remain inside the candidate.
The CommonJS dependency validator cannot directly check the ESM-only Pi entry or the MCP package root.
The separate import check uses the actual source specifiers and does not certify the complete transitive ESM module graph.
A subsequent private candidate includes the current Futu cleanup sources and later runtime tests.
Its composition validation, Electron dependency validation, and isolated launcher smoke passed.
Seven Personal Bot dependency entry imports also passed; all dependency links stayed inside this candidate.
All 898 captured files and the candidate inventory remained unchanged during validation.
Its dependency manifests and lockfiles match the preceding candidate; no dependency installation occurred.
Smoke reported `ok:true` at 1920 by 1280 pixels with private configuration, state, workspace, and Electron profiles.
These checks do not establish Linux or Windows binaries, deployment, device behavior, or complete preflight.
The authorized CM5 isolated check used Linux arm64 dependencies installed from the candidate lockfiles on 2026-10-10.
The source archive SHA-256 was `e2d302f94e3e2e25553f45a3fb2304837b47afde7c9e4896624be96b40a65c80`.
The candidate directory was `/tmp/odk-plugin-cm5-31b8uaXB`.
Composition validation, Electron dependency validation, seven Personal Bot imports, and isolated launcher smoke passed as `orangepi`.
Smoke reported `ok:true` at 1920 by 1280 pixels; all 896 archived regular files remained unchanged.
Configuration, state, runtime endpoints, workspace, and Electron profiles used private directories.
The first dependency installation encountered a read-only existing package store; installation passed with a candidate-owned store.
The active release remained `20261004-connection-fixes-v2`; a subsequent check of the `orangepi` Shell service reported `active`.
No release activation, service configuration change, camera capture, or microphone capture occurred.
These checks establish target startup and dependency loading, not complete behavior, physical input, or full preflight.
CM5 headless responsive checks passed 30 scenarios across both promised panel sizes with zero violations.
The existing density command passed all five standard sizes for live and unavailable fixture states, with zero violations.
These checks used software rendering and controlled data; they do not establish physical presentation or provider acceptance.
The initial aggregate interaction attempt exceeded its temporary outer deadline and left an Electron child running.
That task-owned process tree was identified and removed; the failed attempt remains unresolved evidence.
A separate Home check reproduced failed pointer disclosure because the hidden window had one-pixel content bounds.
The fixture now sets its requested content size after loading and dispatches resize before input assertions.
Its new isolation regression failed before repair; 17 affected Node checks passed afterward on macOS and CM5.
The corrected CM5 headless Home check passed 18 theme and size cases, pointer disclosure, and keyboard paging.
Six staged test files changed for the fixture repairs; their previous and updated hashes are recorded separately.
The production source files remain unchanged.
The aggregate interaction rerun exited with status one.
Its driver, motion, geometry, interiors, sequential refinement, Hydra style, and six density child checks passed.
Two child checks failed: first MIC control invocation and installed Widget placement after compact resizing.
Two further isolation regressions reproduced their synchronization defects before repair.
The MIC fixture now waits for control receipt without replaying input.
The installed Widget fixture applies renderer viewport metrics and waits for grid dimensions before geometry assertions.
All 19 affected Node checks passed on macOS and CM5.
Both corrected fixtures passed standalone checks on CM5; these checks compiled the uploaded test sources against the staged runtime.
The subsequent aggregate interaction command passed with exit status zero on CM5.
Its driver, motion, geometry, interiors, sequential refinement, Hydra style, six density runs, and seven theme child checks all returned zero.
All 896 archived regular files remained unchanged during the successful command.
The earlier failed attempts remain recorded separately; the successful complete rerun clears this fixture gate.
The five existing Hydra surface replacement modes failed their 70-second fixture deadlines on CM5.
Those results do not establish target replacement behavior.
A separate sequential observation completed all 30 default Cell groups and reached the alternative phase's twenty-fourth group before the deadline.
The Linux arm64 fixture budget is now 150 seconds; parent and test budgets are 160 and 180 seconds.
Other host budgets and all comparison assertions remain unchanged.
The complete five-mode CM5 rerun passed with zero failures or skips in 529629 milliseconds.
It covers development, signed Native, runtime development, runtime Native, and runtime scale override modes.
All 896 archived regular files remained unchanged during that command.
The subsequent aggregate interaction rerun used the corrected MIC and installed Widget fixtures and passed.
The corrected aggregate interaction command also passed on macOS in a separate candidate with private configuration and state.
Composition and Electron dependency validation passed before that command.
The aggregate command completed in 135 seconds; all child status values were zero.
All 898 candidate regular files remained unchanged, with no added or removed files.
These results cover controlled interactions; they do not establish live capture, physical presentation, or Windows acceptance.
Windows returned online through Tailscale at `100.82.50.70`; SSH reached `DESKTOP-QLQD17F` with Node `v24.21.0`.
The user subsequently authorized Windows acceptance in a separate candidate with private configuration, state, dependencies, and profiles.
Graphical Windows checks ran in the existing interactive desktop session without activating the candidate or changing production tasks.
Composition, dependency validation, seven Bot imports, type checking, and the 1280-by-776 startup check passed.
The responsive matrix passed 30 scenarios with no findings; captured content uses controlled inputs.
The Windows native process reader built and loaded in Electron after the fixture selected the installed Python explicitly.
The first selected Bot run passed five scenarios and failed confirmed memory execution before the selected Agent comparison.
An isolated reproduction confirmed that Unix owner and mode checks rejected Windows memory writes.
Memory storage now uses the existing private-file helpers for Windows ACL validation and protected temporary files.
The new memory regressions failed before this repair and passed afterward.
Eight Windows checks passed, including actual selected Agent execution, exact grants, memory reload, broad ACL rejection, and hard-link rejection.
Existing broad ACLs remained unchanged; new private files received owner ACLs before content writes.
A fresh independent security review reported no actionable findings.
A separate native NULL DACL probe confirmed that the existing helper rejects that access state.
The affected CM5 command passed 32 checks and skipped two Windows checks after the isolated candidate supplied the repository module layout.
The initial CM5 attempt failed because that layout was absent; it did not show a memory behavior failure.
Windows plugin and fixture checks passed 116 tests after the diagnosis fixture supplied its private named pipe and token file.
The first aggregate interaction attempt exhausted the indicator deadline and retained a locked profile during shutdown.
The fixture now uses the existing extended matrix budget on Windows and tolerates Windows profile locks during termination.
The cleanup regression failed before repair; all 29 affected local checks passed afterward.
The complete Windows interaction rerun passed in 446 seconds, with every child status zero and all 896 captured inputs unchanged.
Both temporary acceptance tasks were removed; no candidate processes remained, and existing product task states were unchanged.
These controlled checks do not establish live providers, microphone or camera capture, physical touch, or complete Windows Bot acceptance.

A subsequent source continuity audit read both existing isolated candidate directories without starting product processes.
All captured production files match the current worktree; the inspected production directories contain no additional files.
The audit compared each candidate against its 896-file reference and treated generated release metadata separately.
Windows differs only in the two coverage documents and the later Hosted Pi record scenario and test.
CM5 also retains earlier documentation and test fixtures; those differences do not certify execution of the latest fixtures.
The reviewed CM5 interaction and indicator differences preserve Linux deadlines and cleanup behavior; their changed branches apply to Windows.
The original CM5 archive predates the memory storage repair; the live candidate contains that repair.
Its later memory checks and current Bot results remain separate evidence from the original GUI command.
This audit establishes source continuity, not another graphical run or additional provider and physical acceptance.
The earlier isolated style build generated 43 utilities and matched the worktree CSS.
Six existing geometry and style entry points passed in the preceding candidate with explicit private profiles.
Responsive checks passed 30 scenarios across the reference and handheld panels with zero violations.
Density checks passed five standard sizes with zero violations.
Pi passed 36 cases; Futu passed twelve contract cases, nine geometry cases, and six captions.
Hydra passed 30 composition cases and ten unconfigured cases; the combined Widget and App style entry also passed.
Eight existing Renderer replacement suites passed 32 tests without failures or skips in 140507 milliseconds.
They cover Camera, Clock, Calendar, desk tools, Quota, Pi status, input status, and Pre-order through development and signed entries.
These checks use the existing geometry commands with private profile arguments; they do not certify independent pixels or all replacement density profiles.
Complete preflight remains unverified because its smoke command does not pass a private Electron profile.
These component checks do not establish signed replacement behavior, Linux or Windows binaries, deployment, or device acceptance.
The subscription repair command passed 135 checks with zero failures or skips in 39420 milliseconds.
It covered shared subscriptions, App behavior, Renderer replacement, Camera, Pi Widget, and service consumers.
Eight ownership regressions failed before repair; six initial replay regressions also failed before their repair.
Two compatibility checks preserve contained callback errors for Gamepad and Tick.
Separate independent reviews passed the focused checks and reported no further findings within these subscription changes.
The current [subscription checks](../tests/shared-service-selection.test.js) define these ownership and initial replay contracts.
[The feature matrix](PLUGIN_FEATURE_MATRIX.md) maps current owners, acceptance sources, and remaining replacement evidence.
The [uncertain operation section](#uncertain-renderer-implementation-operation-acceptance) records the current management boundary and published retirement gap.
The [rendering input section](#hydra-replacement-comparison-rendering-inputs) records the latest Hydra comparison controls and verification.
[PRODUCT](../../../PRODUCT.md) owns product scope.
[ARCHITECTURE](ARCHITECTURE.md#proposed-target) owns the proposed kernel and plugin boundaries.

The kernel retains startup, authorization, windows, direct input, Back, and recovery responsibilities.
A plugin failure must not block independent features or direct input.
Installed HTML packages retain their existing authority limits.
Local native code remains trusted; capability declarations do not provide a sandbox.

The existing Shell composition checks also passed on macOS, Windows, and CM5 on 2026-10-10.
Each command passed 78 checks without failures or skips.
The Windows command completed in 197 milliseconds; the CM5 command completed in 381 milliseconds.
Each isolated device candidate retained all 210 captured inputs unchanged.
These checks cover source IPC payloads, selected consumers, catalog rebinding, notification routing, subscription ownership, and failed release retries.
They use controlled Electron interfaces and providers; they do not establish GUI, physical input, or external service acceptance.
No production source changed for this verification.

Run this command from `runtime/shell/`:

```sh
node --test --test-timeout=120000 tests/data-source-plugins.test.js tests/system-channel-plugins.test.js tests/desk-runtime-plugins.test.js tests/shared-service-selection.test.js
```

The external runtime checks below also completed on 2026-10-10.
A fresh comparison still matches all 322 captured Personal Bot inputs and all 127 final Futu audit inputs.
The 24 captured Remote Bridge files and 72 peripheral host files also match their passing command snapshots.
These comparisons establish input continuity for those checks; they do not add live provider or physical acceptance.

| Scope | Result | Command and directory |
| --- | --- | --- |
| Current complete Personal Bot suite, including selected task engine, STT, independent Home and Watch, proactive consumers, and in-flight Agent lifecycle | 602 passed, three skipped; 26887 milliseconds | `node --test --test-timeout=120000 tests/*.test.mjs` in `integrations/personal-bot/`, with private `HOME` and short `TMPDIR` |
| Resident Bot and Hosted Pi composition | 64 passed | `node --test --test-concurrency=1 tests/plugin-composition.test.mjs tests/task-composition.test.mjs tests/development-plugins.test.mjs tests/task-development-plugins.test.mjs tests/runtime-control.test.mjs tests/task-runtime-control.test.mjs` in `integrations/personal-bot/` |
| Bot types | Passed | `corepack pnpm@11.22.0 typecheck` in `integrations/personal-bot/` |
| Remote Bridge | 65 passed | `node --test --test-concurrency=1 test/*.test.js` in `integrations/remote-bridge/` |
| Futu Python | 286 passed, two native Windows checks skipped | `uv run --no-project --with pytest python -m pytest tests -q -W error::RuntimeWarning --basetemp "$odk_futu_test_root/run"` in `integrations/futu-poller/` |
| Native Windows Futu management | 16 passed, zero skipped | `uv run --no-project --with pytest python -m pytest tests/test_windows_management.py -q -W error::RuntimeWarning` in the isolated Windows `integrations/futu-poller/` candidate |
| Common native host | Four passed | `uv run --with pytest python -m pytest tests -q` in `peripherals/common/` |
| S3 and P4 host checks | 23 passed | `uv run --with pytest python -m pytest peripherals/esp32-s3-remote/tests peripherals/esp32-p4-camera/tests -q` at the repository root |
| Combined common, S3, and P4 host rerun | 28 passed; 8.31 seconds | `uv run --with pytest python -m pytest peripherals/common/tests peripherals/esp32-s3-remote/tests peripherals/esp32-p4-camera/tests -q` at the repository root |

S3 native [host checks](../../../peripherals/esp32-s3-remote/README.md) also passed both frame and touch tests in a private CMake build.
The boundary audit refreshed Remote Bridge, Futu, common native, S3, and P4 checks with private directories and controlled inputs.
Each command retained its 127 captured inputs without changes, additions, or removals during execution.
Only three Futu test and documentation files changed between the initial commands and the final Futu run.
Production files remained unchanged; the final Futu snapshot matched all 127 captured files.

The initial Futu command failed because one test treated valid, deeply nested JSON as invalid on every interpreter.
The corrected CLI case rejects an invalid `enabled` value inside deeply nested data.
A separate injected decoder failure checks the generic diagnostic, retained explicit disables, and unchanged file.
The correction adds no production nesting limit; fresh independent review reported no actionable findings.
These host checks do not establish flashed firmware, live gateways, physical touch or USB behavior, or live capture.

Native Windows Futu [management checks](../../../integrations/futu-poller/tests/test_windows_management.py) passed 16 tests.
They include actual Python named pipes and the Node local control client.
The composition comparison rejects a wrong token before publisher disable.
Enable restores a fresh publisher and dependent loop.
The control channel and independent gateway retain their identities; control self-disable fails while inventory remains available.
Saved startup preferences remain unchanged, and shutdown releases both publisher generations and all owned pipe handles.
The private candidate retained all 28 captured Python and Node inputs without changes.
The same composition comparison now calls the actual unified CLI for native Windows disable, enable, and protected-control refusal.
A test adapter retains native Windows host resolution and maps all discovery endpoints and the token file to isolated test resources.
It does not intercept inventory, authentication, command dispatch, lifecycle transitions, or CLI result validation.
Wrong-token discovery cannot change the publisher, and runtime commands do not create a saved CLI preference file.
The Windows rerun passed all 16 tests without skips across 153 unchanged captured Python, Shell, and CLI inputs.
This result does not establish the production endpoint names, production credentials, or deployed operator integration.
A separate fresh source review reported no actionable findings in the CLI isolation, dispatch, or lifecycle assertions.
The final local Futu command passed 286 tests and skipped two native Windows checks across 127 unchanged captured inputs.
Fresh independent source review reported no actionable findings in this native management increment.
These checks use controlled resources; they do not establish live SDK, gateway, deployed operator, or full Futu behavior acceptance.

P4 host checks execute actual composition functions with selected I2C, camera, and USB providers against SDK mocks.
S3 [consumer checks](../../../peripherals/esp32-s3-remote/tests/test_plugin_contract.py) execute actual Surface and Serial lifecycle functions with generated descriptors and controlled providers.
They compare default and selected buffer providers, verify render arguments, and retain dependencies until failed display draining succeeds.
Successful cleanup clears consumer references and does not repeat completed Serial cleanup.
The hardware loop and physical display, touch, and USB behavior remain outside these lifecycle checks.

Create `odk_futu_test_root` with `mktemp -d /tmp/odk-ft-XXXXXX` before the Futu command.
The current complete Personal Bot command reported 605 tests, 602 passes, three skips, and exit status zero on 2026-10-10.
All 322 captured source, test, scenario, script, and package files remained unchanged; the final file inventory also matched.
The preceding in-flight lifecycle run reported 595 tests, with 593 passes and two skips across 322 unchanged captured files.
The preceding complete run reported 594 tests, with 592 passes and two skips across 299 unchanged captured files.
The added [Agent selection scenario](../../../integrations/personal-bot/features/plugin-composition.feature) checks in-flight runtime disable through the actual resident composition and voice service.
Default Pi adapter and trusted external Agent implementations finish the pending request, release its synthetic recording, and retain service and channel identities.
After enable, a fresh Agent answers another request; captured old callbacks cannot change the current response.
The external Agent owns this response and cancellation behavior; default construction is refused during selected execution.
The complete selected Agent command also passed 23 tests on the isolated CM5 candidate with zero failures or skips.
The voice comparison now calls the existing transcription consumer with the selected runtime's STT configuration and synthetic file bytes.
Controlled requests confirm each runtime's distinct endpoint, model, and context, plus automatic language and disabled translation for the local provider.
Both implementations retain identical service outcomes through failure and restart without real recording or provider access.
The extended comparison passed locally and on the isolated CM5 candidate; staged inputs remained unchanged during that command.
The [Home consumer check](../../../integrations/personal-bot/tests/agent.test.mjs) compares the default Pi adapter with a selected external runtime through the resident composition.
Both use the actual Home consumer with bound synthetic plugin readings and publish identical facts and source metadata.
Changed values update without another generation; disabled Home instances cannot publish, and fresh instances resume through the same service and channel.
The extended check retains stale facts after generation failure and restores live facts after recovery without exposing private errors.
Runtime disable settles pending Home generation; a late result cannot replace the fresh instance's facts.
The external entry owns generation and never constructs the default adapter.
This check passed locally and on the isolated CM5 candidate; Bot type checking also passed.
The CM5 test and scenario updates have separate before and after hashes; both files remained unchanged during the command.
The complete Bot rerun after this extension retained 594 passes and two skips across 322 unchanged captured files.
These results do not establish proposal generation, phrasing, execution, real provider responses, or physical input.
The separate [proactive consumer check](../../../integrations/personal-bot/tests/proactive-integration.test.mjs) selects default and external Agents through the resident composition.
It compares the actual Watch for both owner rule and owner goal contracts with synthetic current evidence and offline judgment.
Rule advice retains approved sentences; presentation and exact confirmation gate updates to isolated memory, and completed actions cannot replay.
Generated advice retains evidence and independent judgment; it has no action or confirmation authority.
The external Agent owns generation, phrasing, and execution; it reuses the memory store without constructing the default Agent.
The check passed locally and on the isolated CM5 candidate; the complete local Bot suite and type checking also passed.
Both staged test and scenario files retained their recorded updated hashes during the CM5 command.
The extended proactive check compares provider failures and recovery for default and selected Agents.
Failed phrasing retains approved owner advice; failed generation reports unavailable suggestions without publishing private errors, and recovered generation resumes grounded advice.
An isolated invalid memory file makes confirmed execution fail after reservation; the Watch retains unknown status after the file recovers.
Execution call counts confirm that recovery and another confirmation cannot replay that action.
The extended check passed locally and on CM5; the complete local Bot suite retained 595 passes and two skips with unchanged inputs.
The selected proactive cancellation check disables the runtime while generation or phrasing waits on controlled providers.
Both default and external Agents settle Watch work without publishing; the default adapter also releases its auxiliary session.
Service and channel identities remain stable, a fresh Watch resumes advice, and released callbacks cannot change current content.
The check passed locally and on the isolated CM5 candidate; staged test and scenario files remained unchanged during execution.
The complete local Bot rerun retained 596 passes and two skips across 322 unchanged captured files; type checking passed.
These checks do not establish live provider cancellation, Windows, or physical interaction.
The Main declaration inventory contained 28 plugin identities on 2026-10-10; each identity has an explicit owner entry in the feature matrix.
Inventory construction did not start factories and does not establish feature behavior or complete product acceptance.
The independent Home check selects an external Home factory through the resident composition and forbids default Home construction during selected execution.
The external implementation owns reading acquisition, fact formatting, publication, refresh scheduling, and release for a controlled Pi reading.
Actual service pushes produce matching facts, source metadata, unavailable disclosure, stale content after read failure, and recovered content.
Home disable leaves the Agent runtime, service, and channel available; the released Home cannot publish, and a fresh Home resumes current facts.
The check passed locally and on the isolated CM5 candidate; both staged inputs remained unchanged during the target command.
The full local Bot suite retained 597 passes and two skips across 322 unchanged captured files; type checking passed.
The added pending-read assertion first failed for the test alternative, which did not forward cancellation to its reading provider.
The test alternative now forwards its reading signal and aborts it on release; the default production Home required no repair.
Both implementations settle pending refresh, and late reading completion cannot change the next Home instance.
The extended check passed locally and on CM5; the complete local suite retained 597 passes and two skips with unchanged inputs.
The multi-source comparison excludes hidden sources and undeclared fields.
It places required sources first, orders optional sources by priority, limits the selected count, and retains the omitted-source count.
The added assertions first failed for the test alternative; the default production Home required no repair.
The corrected comparison passed locally and on CM5 with controlled session and weather readings.
The complete local suite retained 597 passes and two skips across 322 unchanged inputs; type checking passed.
Complete template-format coverage remains separate; Home checks do not establish independent Watch behavior.
The independent Watch comparison selects a separate factory without constructing or delegating to the default Watch.
It owns evaluation, advice publication, presentation, exact confirmation, execution reservation, scheduling, and release for one controlled owner rule.
Unavailable evidence produces no suggestion; current evidence produces matching advice, action, and evidence metadata through the actual resident service.
Service commands refuse execution before presentation or with another confirmation; exact confirmation executes once and subsequent replay is refused.
Watch disable preserves service, channel, Agent, and Home identities; the released instance cannot publish, and a fresh Watch resumes suggestions.
The initial lifecycle-only alternative failed the advice assertion; the implemented alternative passed locally, on CM5, and on Windows.
The preceding complete local suite passed 598 tests with two skips across 322 unchanged captured inputs; type checking passed.
Both device checks retained their recorded test and scenario hashes during execution.
The independent Home comparison now checks 8192-byte UTF-8 source limits and the 48000-byte aggregate input budget.
At the source limit, declared data remains live; above it, required data becomes an error source and optional data is omitted.
Oversized undeclared fields remain excluded before budgeting.
Seven required sources retain their identities and bounded data or error states when the aggregate budget is exceeded.
The selected fixture first failed both limit comparisons; its independent implementation now applies the existing limits.
The default production Home required no change.
The extended comparison passed locally, on CM5, and on Windows with unchanged captured test and scenario inputs.
The subsequent complete local Bot suite passed 600 tests and skipped three across 322 unchanged captured inputs; type checking passed.
Complete template-format coverage remains outside this bounded comparison.
The controlled execution provider does not write memory.
Separate Windows checks now pass actual confirmed memory execution through the default and selected Agent.
The extended comparison disables default and selected Watch instances during reading, judgment, and phrasing.
Each controlled provider receives cancellation; pending polling settles without publication, and fresh instances retain the existing peer resources.
Late completion cannot change the new suggestion or publish another service frame.
The judgment assertion first failed because the test alternative omitted its cancellation signal; forwarding that signal resolved the failure.
The default production Watch required no repair.
The extended check passed locally, on CM5, and on Windows; the full local suite and type checking passed with unchanged captured inputs.
These cancellation results use cooperative controlled providers.
The owner-rule comparison also covers ten delivery cases through actual service commands.
Silent and quiet delivery defer automatic popups; urgent advice can appear during quiet hours.
The quiet-hour cases use UTC and New York time zones.
Routine cases cover before-due, due, and acknowledged owner days; only presentation acknowledgement saves the owner day.
Snoozed and suppressed rules produce no proposal; busy state queues presentation until it clears.
Repeated polling does not repeat an automatic popup, and explicit listing retains the applicable routine restrictions.
Every delivery case verifies that no proposal action executes.
Busy state is injected directly through Watch; these cases do not verify service voice lifecycle transitions.
The independent fixture first failed silent delivery; its policy implementation now passes the comparison.
The default production Watch required no change.
The extended comparison passed locally, on CM5, and on Windows with unchanged captured test and scenario inputs.
The full local Bot suite passed 600 tests and skipped three across 322 unchanged captured inputs; type checking passed.
A fresh independent review found no actionable issue in the delivery comparison.
The subsequent checkpoint comparison uses actual private state files through the existing proposal store.
It copies a default presented proposal into the selected implementation store and retains its identity and acknowledgement without migration.
The controlled execution provider reads its executing reservation from disk before it returns a result.
Completed state survives restart without replay; a persisted executing state becomes unknown and also cannot replay.
A controlled checkpoint write failure blocks execution and publishes a redacted error.
After recovery, the unexecuted proposal retains its saved identity and pending state.
Corrupt data fails Watch initialization without rewriting the file; service, channel, Agent, and Home remain available.
The selected fixture first lacked persisted proposals; it now uses the existing load and save interfaces.
The default production Watch required no change.
The local complete Bot suite passed 600 tests and skipped three across 322 unchanged captured inputs; type checking passed.
The CM5 checkpoint comparison also passed with unchanged staged test and scenario inputs.
The first Windows native checkpoint comparison passed in 159 seconds.
A fresh review identified a missing assertion before re-acknowledgement of the imported checkpoint.
The selected import now asserts saved acknowledgement and no startup popup before another service command.
The reviewed local suite passed 600 tests and skipped three; the reviewer confirmed that the finding was resolved.
The reviewed Windows native checkpoint rerun passed in 160 seconds with unchanged staged test and scenario inputs.
The reviewed CM5 rerun also passed with unchanged staged test and scenario inputs.
The initial checkpoint test used a 240-second Windows budget because private-file checks call the native ACL helper.
The subsequent owner recovery extension checks four initialization expiry cases using actual private proposal files.
It changes the owner rule, removes its action, modifies the saved action, or removes the saved judgment.
Each case observes expired state before startup polling, verifies its saved expiry, and refuses action execution.
The removed-action case keeps the current rule version, so version checking cannot hide missing action authorization.
Two lost-acknowledgement cases retain the saved proposal identity for immediate and routine delivery.
Immediate delivery retries automatically; routine delivery requires an explicit service-list request.
Acknowledged routine delivery retains its saved owner day and stays quiet after restart.
Acknowledged immediate proposals remain available through an explicit service-list request.
The selected fixture first failed that explicit-access comparison; it now honors the existing reveal-all argument.
The default production Watch required no change.
The complete local Bot suite passed 600 tests and skipped three across 322 unchanged captured inputs; type checking passed.
The CM5 and Windows extensions passed with unchanged staged test and scenario inputs.
The first extended Windows command exceeded its 360-second budget and exited with one cancelled test after 383 seconds.
That attempt reported no assertion failure and retained unchanged staged test and scenario inputs.
The fixture now uses a 900-second Windows budget and records comparison stages; behavior assertions remain unchanged.
The extended native Windows rerun passed in 383 seconds, with zero failures, cancellations, or skips.
All eight default and selected comparison stages completed.
A fresh independent review found no actionable issue in the initialization and lost-acknowledgement comparisons.
The next comparison advances the evidence clock to the exact maximum age and then one millisecond beyond it.
Both implementations retain pending state at the boundary; actual service listing expires older evidence without a popup.
Confirmation refuses the expired proposal and leaves the execution count unchanged.
The independent fixture first failed this comparison; its listing now expires evidence before presentation eligibility is calculated.
The default production Watch required no change.
The focused local, CM5, and Windows comparisons passed with unchanged staged test and scenario inputs.
The native Windows command completed all ten comparison stages in 382 seconds, with zero failures, cancellations, or skips.
The complete local Bot suite passed 600 tests and skipped three across 322 unchanged captured inputs; type checking passed.
A fresh independent review found no actionable issue in this evidence-age comparison.
The owner-save failure extension uses the actual private proposal store and service acknowledgement command.
The command fails when owner configuration cannot be saved, but its presentation acknowledgement remains on disk.
Restart retains the proposal identity and acknowledgement without another automatic popup.
Explicit listing while busy defers presentation until the busy state clears.
Exact confirmation then executes the controlled action once, with its executing reservation already saved.
The completed proposal and cooldown survive their respective saves; another restart cannot replay the action.
The default and selected comparisons passed locally and on CM5 without implementation changes.
The full local Bot suite passed 600 tests and skipped three across 322 unchanged captured inputs; type checking passed.
A fresh independent review found no actionable issue in the owner-save failure comparison.
The native Windows command passed all twelve comparison stages in 469 seconds, with zero failures, cancellations, or skips.
Its staged test and scenario inputs remained unchanged.
A separate Watch factory now compares generated advice for one owner goal with immediate or silent delivery.
It owns observation selection, generation requests, judgment selection, proposal storage, presentation, and lifecycle without constructing the default Watch.
Only the pure generated batch validator is shared.
Unavailable observations cause no generation request; failed generation and invalid citations or action fields publish no advice.
A high usefulness score cannot defeat a low grounding score.
Accepted advice retains probability order, selected evidence fields, stable proposal identities, and no action authority.
Judgment requests retain the generated marker, owner goal, rule identity, empty criteria, and resolvable evidence references.
The added marker assertion first failed the selected fixture; the fixture now supplies the existing judgment contract.
The selected factory reads the actual default private checkpoint and retains identities and acknowledgement before another poll.
Repeated generation and restart do not repeat the acknowledged automatic popup.
A fresh independent review confirmed the marker refinement without actionable findings.
The full local Bot suite passed 601 tests and skipped three across 322 unchanged captured inputs; type checking passed.
The reviewed CM5 and Windows comparisons passed with unchanged staged test and scenario inputs.
The native Windows command completed in 72 seconds, with zero failures, cancellations, or skips.
The existing service can retain an earlier proposal error in its status until another state update, despite publishing recovered advice.
This pre-existing behavior is outside the replacement comparison; the production service remains unchanged.
Four added generated delivery cases use fresh proposal files and Watch instances for each default and selected comparison.
The push limit retains only the highest-ranked accepted candidate.
Silent delivery and quiet hours retain advice without an automatic popup; urgent advice retains its quiet-hours exception.
Actual service listing reveals queued advice, and repeated polling cannot repeat automatic popups before or after acknowledgement.
The independent fixture first failed silent delivery; its automatic presentation gate now preserves the existing policy.
The default production Watch remains unchanged.
A fresh independent review found no actionable issue in these four comparisons.
The full local Bot suite passed 601 tests and skipped three across 322 unchanged captured inputs; type checking passed.
The extended CM5 and Windows comparisons passed with unchanged staged test and scenario inputs.
The native Windows command completed in 240 seconds, with zero failures, cancellations, or skips.
Routine generated delivery, busy state, snoozing, suppression, topic revision changes, coding goals, and remaining failure recovery need separate evidence.
These checks do not establish real recording, transcription providers, model behavior, Home generation, or proactive proposal consumers.
Shell comparison found no changed, added, or removed production sources and scripts against the latest full Shell snapshot.
The two later installed runtime test inputs differed; their affected checks passed separately.
Three Home fixture, isolation, and scenario inputs changed afterward; their affected checks and CM5 fixture passed as recorded above.
Two Hydra timeout inputs also changed afterward; their complete five-mode CM5 rerun passed.
The later MIC and installed Widget fixture inputs have focused passing results; their complete CM5 aggregate interaction rerun also passed.
The initial flattened candidate run failed because repository tests required checkout resources and repository-relative helpers.
The first checkout rerun also exposed Unix socket path limits in the default macOS temporary directory.
Seventeen affected checks passed with a short private temporary directory before the complete rerun passed.
The failed attempts remain separate evidence and do not establish candidate release behavior.
The local suite skips Windows SSH acceptance and two native Windows ACL scenarios.
The two ACL scenarios passed in the authorized Windows candidate.
The first Futu run exceeded the macOS Unix socket path limit in the default temporary directory.
The isolated short directory run passed; the skip requires native Windows management.
These checks use local fixtures and do not establish live providers, deployment, physical input, capture, or hardware acceptance.

## Open DeskOS Data Link selection verification

These checks completed on 2026-10-10 and are included in the latest full Shell run.
The [shared checks](../tests/odk-data-replacement.test.js) compare default and alternative Link implementations through the existing Personal Bot client.
The [alternative](../tests/fixtures/odk-data-link-replacement.js) owns framing and listener lifecycle without calling the default listener.
It reuses the authenticated local channel and the selected read-only control.
Actual list and read requests preserve source readings, current package publications, and their untrusted flag.
Both implementations reject mutation requests and release their socket when disabled.
Recovery preserves the registry and published values; final shutdown removes the socket.
Counters confirm two alternative listener starts, two releases, eight requests, and zero default listener starts.
The affected command passed 89 checks with zero failures or skips in 3291 milliseconds.
The first run exposed fixture readiness and request-count errors; the corrected checks await listener readiness without timers.
No production interface or implementation changed for this verification.
These initial results established local Unix startup selection and consumer behavior without supported-device acceptance.

### Native Open DeskOS Data Link acceptance

The existing replacement command subsequently passed all 21 scenarios on Windows x64 and CM5 Linux arm64 on 2026-10-10.
Windows completed in 4.86 seconds; CM5 completed in 7.87 seconds, with zero failures, cancellations, or skips.
All 232 captured inputs remained unchanged on both hosts and matched the worktree afterward.
Private candidates retained the repository directory structure for actual Personal Bot imports.
They reused dependencies from the previous isolated candidates through explicit links.
Both dependency owners' manifests and lockfiles matched the captured source on each host.

The initial Windows command passed 15 scenarios and skipped six Link scenarios because the fixture required Unix sockets.
Production already supports Windows Open DeskOS Data through an authenticated named pipe.
The fixture now selects a unique test pipe, private token file, and explicit Bot client environment on Windows.
Unix checks retain their socket-path assertion; both hosts also require a failed connection after release.
Existing default, alternative Link, and signed registry scenarios now run on both hosts.
They preserve reading ownership, publication state, revisions, catalog cancellation, mutation refusal, release, and recovery.

The first expanded Windows run timed out in its first Link scenario and completed the other twenty scenarios.
Bot SDK import now runs once in bounded setup before the unchanged ten-second Link scenario deadlines.
The final native commands passed; the local affected command passed 89 checks with zero skips in 3.84 seconds.
A fresh independent source review found no actionable findings.
It did not independently execute native checks or validate their captured results.
Shared authentication checks own missing-token, incorrect-token, and token-storage requirements; these scenarios check authenticated consumers and release.
No production sources, active services, or product endpoints changed.
These controlled service checks do not establish full Electron startup, live provider behavior, physical input, or production activation.

Run this command from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/odk-data-replacement.test.js tests/odk-data.test.js tests/odk-data-shell.test.js tests/odk-data-wiring.test.js tests/desk-runtime-plugins.test.js
```

## Shared service input ownership

The default Home Briefing, Remote Link, connection, and gamepad services release upstream listeners when another implementation is selected.
Restoration reconnects listeners and reads current source state.
Old callbacks and pending Home Briefing responses remain inactive after restoration.
Remote Link reads the existing Main status endpoint; a later event takes precedence over the initial response.
Gamepad restoration reuses the existing input module to read current presence without emitting navigation intents.
Replacement instances retain responsibility for their own resources.
Existing mounted consumers select another service after remounting; registration does not migrate their subscriptions.

Eleven failing regressions reproduced retained inputs, late responses, stale restoration, and synchronous selection during restoration.
The 17 new checks cover cleanup failure, retry, repeated selection, and late response rejection.
Independent review found the synchronous restoration defect; four failing regressions confirmed it before repair.
The corrected binding owns cleanup before it notifies consumers.
Independent review repeated 44 focused checks and reported no further actionable findings.

The affected command completed with exit status zero on 2026-10-10.
It reported 161 passed, zero failed, and zero skipped tests in 92875 milliseconds.
Actual Electron checks include selected Home Briefing consumers and selected connection and gamepad status consumers.
Development and signed input surface cases include service selection and default restoration without document navigation.
The end-to-end command `corepack pnpm@11.22.0 e2e` also completed with exit status zero.
It passed navigation, motion, geometry, App interiors, sequential states, and Hydra checks.
All six density runs and seven theme fixtures returned zero.
The first run exposed missing Remote Link status mocks despite passing its assertions.
Seventeen standalone fixtures now declare this status endpoint; 58 service and isolation checks passed after that correction.
The complete end-to-end rerun passed without missing Remote Link handlers.
The other standalone fixtures received declaration and syntax checks; they were not each executed separately.
These results do not establish complete service contract coverage, physical input, Windows, or CM5 acceptance.

Historical command from before the Camera Widget retirement:

```sh
node --test --test-concurrency=1 tests/shared-service-selection.test.js tests/preload.test.js tests/voice-mic-preload.test.js tests/agent-home.test.js tests/briefing-store.test.js tests/gamepad-state-service.test.js tests/gamepad-input.test.js tests/home-briefing-frame.test.js tests/dashboard-lifecycle.test.js tests/dashboard-lifecycle-electron.test.js tests/dashboard-surface-electron.test.js tests/dashboard-main-bootstrap.test.js tests/input-status-surface-lifecycle.test.js tests/input-status-surface-electron.test.js tests/shell-robustness.test.js tests/renderer-runtime-controller.test.js tests/renderer-runtime-replacement.test.js tests/system-channel-plugins.test.js tests/main-smoke.test.js tests/pixel-icons.test.js tests/camera-surface-electron.test.js tests/builtin-view-replacement.test.js tests/app-interiors.test.js
```

## Current boundaries and remaining proof

Installed desktop composition now has a separate [Renderer plugin contract](INSTALLED_DESKTOP_PLUGIN_CONTRACT.md).
Its startup paths include trusted preloaded, development, and signed definitions; authenticated runtime management remains unimplemented.

| Surface | Authoritative implementation | Current boundary | Remaining proof |
| --- | --- | --- | --- |
| Main sources and services | [Main composition](../src/plugins/main-composition.js) | Declared dependencies and explicit replacement definitions | Feature parity for every replacement and supported host |
| Main external code | [Development loader](../src/development-plugins.js), [Native loader](../src/native-plugin-loader.js), [native guide](NATIVE_PLUGINS.md) | Development links, signed revision selection, captured CommonJS startup, explicit trust and grants | Complete module compatibility, signed replacement parity, and supported-host acceptance |
| Renderer surfaces | [Registry](../src/renderer/core/registry.js), [native startup](NATIVE_PLUGINS.md#renderer-startup) | Declared lifecycle, authenticated runtime commands, trusted development selections, and captured signed browser entries and assets | Complete signed replacement parity, production deployment, feature health, and supported-host acceptance |
| Appearance | [Appearance host](../src/renderer/core/appearance-plugins.js) | Packaged and signed factory selection, local palette declarations, shared installed package context, startup preferences, and diagnosis | Complete signed implementation parity, installed-package interaction, and supported-device acceptance |
| Installed Widgets and Apps | [Package contract](USER_APPLICATIONS.md) | Verified HTML revisions with install, update, rollback, and removal | Full interaction and resource acceptance for each package |
| Resident Personal Bot | [Composition](../../../integrations/personal-bot/src/plugin-composition.mjs) | Versioned factories, trusted external startup selections, offline inspection, common startup preferences, and runtime component enable operations | Supported-host live management and real agent replacement parity |
| Hosted Pi | [Task composition](../../../integrations/personal-bot/src/task-composition.mjs) | Listener, service, endpoint lifecycle, runtime diagnosis, trusted startup selections, offline inspection, common startup preferences, and independent live management | Supported-host management and task replacement acceptance |
| Remote Bridge | [Transport runtime](../../../integrations/remote-bridge/lib/plugin-runtime.js) | Declared transports, trusted startup selections, offline inspection, common startup enable preferences, and runtime transport enable operations | Unified live management, full external transport parity, and physical transport handover |
| Futu Python | [Composition](../../../integrations/futu-poller/poller.py), [Host](../../../integrations/futu-poller/plugin_host.py) | Synchronous factories, replaceable transport, versioned ports, startup preferences, negotiated diagnosis, independent Unix management, and a token-gated Windows pipe backend | Deployed Windows operator and diagnosis integration, SDK/gateway acceptance of alternative implementations, and deployed-host acceptance |
| S3 Remote | [Native ports](../../../peripherals/esp32-s3-remote/main/remote_plugin_ports.h), [runbook](../../../peripherals/esp32-s3-remote/README.md#native-component-plugins) | Generated descriptors, typed driver, buffer, gesture, and surface ports, local snapshots, and bounded JSON reports | Operator report transport, board startup, touch input, display, and USB behavior |
| P4 Camera | [Native ports](../../../peripherals/esp32-p4-camera/main/p4_plugin_ports.h), [runbook](../../../peripherals/esp32-p4-camera/README.md#native-component-plugins) | Storage, I2C, camera, USB, microphone, and video lifecycle with local snapshots and bounded JSON reports | Operator report transport, physical camera, microphone, USB, and DMA behavior |

Renderer registrations and built-in placement remain packaged declarations.
Installed HTML packages use their separate catalog and placement contract.
Development links separate Main factories from renderer browser entries.
They do not load Bot, Python, or firmware code.
Python has a separate [explicit startup selection](../../../integrations/futu-poller/README.md#trusted-development-replacements) for trusted local replacement entries.

The CLI inventory covers Main, renderer, resident Personal Bot, Hosted Pi, Remote Bridge, and installed packages.
It does not establish a unified inventory of all runtimes.
A Camera health result describes cached state, not current device connection.
[Configuration](CONFIGURATION.md#plugin-diagnosis) owns health semantics and endpoint requirements.

## Installed desktop composition lifecycle

The following focused command completed on 2026-10-10 with 37 passed, zero failed, and zero skipped tests.
It includes eight isolated actual Electron Shell modes and shared default and independent behavior checks.

```sh
node --test --test-concurrency=1 tests/user-app-desktop-plugins.test.js tests/user-app-desktop-plugins-electron.test.js tests/user-app-desktop.test.js tests/user-app-desktop-independent.test.js tests/renderer-runtime-controller.test.js
```

New regression checks failed before repairs for recovery after shutdown, malformed controller cleanup, initial startup shutdown, and invalid factory results.
Another failing regression established lost settlement ownership for rejected asynchronous mounts.
Frame release retry and refresh after disposal also have regression checks.
A fresh independent review repeated the 37 checks and reported no further actionable findings within this lifecycle scope.
These results do not establish external loading, runtime replacement, full-system completion, live package installation, or supported-device acceptance.

The lifecycle candidate's Shell command `corepack pnpm@11.22.0 test` completed with exit status zero on 2026-10-10.
It reported 1920 tests: 1918 passed, zero failed, and two skipped in 796144 milliseconds.
The 642 recorded source, test, script, and package files remained unchanged during this run.
The skipped checks require Windows named pipe authentication and PowerShell microphone-name encoding.
An earlier full run was stopped after review required further implementation changes; it is not final acceptance evidence.
The final run proves the local Shell test gate, not device acceptance or completion of remaining feature replacement work.

## Installed desktop external startup

Production Main startup checks completed on 2026-10-10 with default and trusted development desktop selections.
All Main plugins ran with private state and controlled external inputs; actual catalog snapshots loaded through preload and the package protocol.
Widget movement and removal retained the unchanged App frame, counter state, neighboring Clock tile, and built-in foreground.
The missing-entry control failed its execution guard; final Renderer and Main shutdown released installed surfaces and handlers.
The affected command passed 38 tests with zero failures or skips in 51105 milliseconds.
It covered Main bootstrap, installed desktop browser composition, Host lifecycle, external loading, and shared independent behavior.
Snapshots were seeded without an installation verifier; these results do not certify installation verification, pixels, live providers, or device acceptance.

Desktop composition now accepts explicitly trusted development links and authorized signed Renderer system revisions.
The shared Main and Renderer validator preserves identity, host, kind, ports, empty requirements, and empty permissions.
The browser loader serves surface and desktop consumers through separate declaration checks and definition endpoints.
Discovery remains authenticated to the known Shell main frame through the existing discovery plugin.

The affected loading, native policy, configuration, CLI, Host, desktop behavior, and browser command passed 125 checks with zero failures or skips.
This run preceded one additional positive execution-marker assertion.
The fresh independent review then repeated all five loader and sixteen browser checks against that assertion.
It reported 21 passed, zero failed, zero skipped, and no outstanding findings.
Private copied entries receive execution markers before signing or linking; healthy loads confirm those markers.
Gated authenticated discovery checks verify cancellation before a late reply and confirm that its entry never executes.
Both external modes check wrong definitions, wrong App surface roles, unchanged package frames, foreground state, Back, and final resource release.

The earlier browser fixtures use actual loaders, discovery, Shell, and preload with controlled Main composition and package bytes.
They do not establish production Main startup; the separate current checks above cover default and development startup selections.
Authenticated runtime management, runtime replacement, and state transfer remain unimplemented for this component.
Density, live providers, physical input, Windows, and CM5 acceptance remain separate gaps.

The external startup candidate completed `corepack pnpm@11.22.0 test` with exit status zero on 2026-10-10.
It reported 1934 tests: 1932 passed, zero failed, and two skipped in 785811 milliseconds.
All 645 recorded source, test, script, and package files remained unchanged during this run.
The skipped checks require Windows named pipe authentication and PowerShell microphone-name encoding.
This result supersedes the earlier lifecycle candidate for the local Shell test gate.
It does not establish completion of the full plugin goal or acceptance on deployed hosts.

### Native installed desktop acceptance

Controlled installed desktop checks passed on Windows x64 and CM5 Linux arm64 on 2026-10-10.
Each host passed sixteen checks with zero failures or skips.
Windows completed in 14.72 seconds in the logged-in interactive Session 1.
CM5 completed in 48.62 seconds as `orangepi`.
All 182 captured source, fixture, helper, and package inputs remained unchanged on both hosts and matched the worktree afterward.
The modes covered default, independent, trusted development, signed loading, invalid contracts, failed cleanup, and shutdown during startup or recovery.
Both external loading modes rejected wrong App surface roles and wrong factory identities.
Gated discovery replies did not execute external entries after shutdown.
Widget revision changes retained the unchanged App frame, its counter state, built-in Clock placement, and foreground App.
Catalog failure retained stale frames; recovery restored the ready state.
Sandboxed Widget frames remained inert, and browser pointer Back closed the foreground App.
Three Shell themes retained the App frame and counter state.
Final shutdown removed installed surfaces and released controllers, Main handlers, discovery, and captured native assets.

Two regression cases failed before the fixture repair.
They cover hidden-window renderer metrics and offscreen rendering.
The fixture now establishes a 1920 by 1280 viewport and unit scale after document loading and before pointer interaction.
Linux uses software rendering without the headless Ozone flag.
Existing behavior, isolation, negative controls, and deadlines remain required.
The affected local command passed 71 checks with no failures or skips in 16.03 seconds.
A fresh independent source review found no actionable findings; the reviewer did not run checks.
The completed Windows acceptance task was removed after terminal confirmation and a task-owned process check.
No task-owned acceptance processes remained on either host.
Production sources, active releases, and product services did not change.

These results establish controlled offscreen composition, frame state retention, lifecycle, and synthesized pointer behavior on both hosts.
Package installation verification, real installed catalogs, density, raster pixels, physical input, and display presentation remain unverified.

Run this affected command from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/e2e-isolation.test.js tests/user-app-desktop-plugins-electron.test.js tests/user-app-desktop-plugins.test.js tests/user-app-desktop-independent.test.js tests/user-app-desktop-loading.test.js
```

## Browser loader consolidation

Surface and installed desktop loading now share one queue, script identity tracker, and definition collection.
The standalone desktop loading module and its Shell script tag were removed.
The existing desktop endpoint remains available with its original declaration and factory contracts.
Each endpoint rejects definitions intended for the other consumer.
Appearance retains its existing shared script-loading interface.

The consolidation preserves startup behavior and adds no plugin management or replacement capability.
Shared queue ordering can delay desktop loading behind surface loading.
Current Shell startup already loads surfaces before it requests desktop loading.
Independent review found no reachable shutdown regression from that ordering.
This refactor uses affected checks; the preceding full-suite result describes the earlier external startup candidate.
The affected command completed with exit status zero: 95 passed, zero failed, and zero skipped in 73029 milliseconds.
It covered surface and desktop loading, Host lifecycle, independent desktop behavior, runtime coordination, Appearance, Clock, and Dashboard.
Actual Electron checks included development and signed paths with controlled rejection and shutdown scenarios.
The first affected run failed one new test because it expected a registration error after an uncaught script error.
The corrected candidate catches that script error, then verifies the loader still rejects the retained invalid definition.
The complete affected command passed after that correction.

```sh
node --test --test-concurrency=1 tests/renderer-development.test.js tests/user-app-desktop-loading.test.js tests/native-appearance-plugins.test.js tests/user-app-desktop-plugins.test.js tests/user-app-desktop-plugins-electron.test.js tests/user-app-desktop-independent.test.js tests/appearance-development.test.js tests/appearance-main-bootstrap.test.js tests/clock-surface-electron.test.js tests/dashboard-surface-electron.test.js tests/renderer-runtime-controller.test.js
```

## Built-in App views through existing replacement

The five packaged App views use the existing Renderer registry and replacement controller.
An alternative fixture implements Calendar, Clock, Pomodoro, Year progress, and Built-in views without packaged mount delegation.
The actual Shell and preload open each view under default, alternative, and restored definitions in one document.
The existing Renderer controller performs replacement and default restoration between closed App sessions.
Trusted development entries use the actual CLI, authenticated Main discovery, Renderer loader, and public App activation.
Five private packages define their selected identities without calling packaged mount functions.
Programmatic, development, and signed loading share the same view, late-response, recovery, and incorrect-Clock checks.
Shutdown removes the authenticated development discovery handler.
The browser fixture observes the native shared Tick interval before initial acquisition and confirms its removal after Renderer shutdown.
Regression checks reproduced a retained interval and service refresh after the final Tick subscriber released.
The shared service now stops its interval after final release and refuses callbacks from cancelled intervals.
A synchronous Camera refresh can release the final consumer; the same Tick then refuses the Quota refresh.
Independent review reproduced that last boundary; a failing regression confirmed it before repair.
Controlled Ticks cover midnight, leap-day rollover, and year rollover.
Catalog checks cover case-insensitive search, missing matches, provider failure, Reload, and empty results.
Programmatic and development checks each complete twenty-seven browser pointer Back operations while retaining the desktop and releasing observed Tick and App state subscriptions.
Programmatic and development modes each check fifteen initial-focus and Tab-containment cycles across the default, independent, and restored views.
Those modes each use fifteen Escape operations to close views and restore the original desktop navigation control focus.
Those modes each use three browser text-input checks to filter the catalog and use Backspace to restore its full results.
Those modes each use three Enter sequences to activate the available Reload button after a controlled catalog failure.
The Enter fixture sends key-down, character, and key-up events to reproduce Chromium button activation.
An incorrect Clock reading fails the same public consumer comparison.
Independent expected-value assertions also check midnight, the calendar date, new-year progress, and truthful Pomodoro unavailability.

The affected command completed with exit status zero on 2026-10-10.
Before signed loading, the affected run reported 119 passed, zero failed, and zero skipped in 38633 milliseconds.
The first new fixture run failed before Tick observation initialized; separating the injected scripts corrected that fixture setup.
These results include App behavior, shared services, runtime coordination, development loading, Camera browser replacement, and Pi Widget loading.
A failing browser regression reproduced late catalog success updating a closed view.
The packaged and alternative views now revoke update permission through the existing scoped cleanup interface.
Programmatic and development checks each settle six controlled late replies across default, alternative, and restored definitions.
Each case reopens the App before settling the old request and checks both retained and current nodes.
Retained search and Reload handlers also leave the released view unchanged.
Independent App review repeated all four browser cases before the shared Tick repair.
The Tick follow-up review passed ten focused checks and confirmed the refresh ownership finding resolved.
The earlier keyboard checks did not establish computed focus styles, density, or supported-device acceptance.
The feature matrix defines current entry-point scope and remaining interaction requirements.
The browser-only fixture uses controlled Main composition and catalog failures; it does not establish complete production Main startup.

The signed increment installs five private bundles through the actual native CLI with Ed25519 signatures and explicit publisher trust.
Authenticated discovery and the verified asset loader execute their entries through opaque asset URLs.
Execution markers identify all five entries; no replacement factories are injected in this mode.
Packaged mounts refuse delegation before the selected Apps open.
The same behavior, keyboard, late-response, and recovery scenarios pass; an incorrect signed Clock reading fails their shared comparison.
Shutdown removes the native asset protocol and discovery handler.
The revision increment uses actual native CLI updates and rollback for all five Apps within the same document.
Entry-owned execution markers identify version two, version three, and version two again.
Each selection operation preserves other plugin preferences; default restoration preserves saved configuration bytes.
Shared scenarios run across default, installed, updated, rolled-back, and restored definitions with unchanged readings and catalog behavior.
The signed check completes 45 pointer Back operations, 25 focus and keyboard closure cycles, and five search and Reload checks.
Ten delayed catalog replies leave released nodes and reopened views unchanged.
The revision-only fixture uses programmatic Renderer replacement; the production increment below adds authenticated activation.
The production increment reuses the [App Manager Main bootstrap](../tests/app-manager-main-bootstrap.test.js) and the shared private bundle builder.
All Main plugins run with controlled external inputs; default and signed startup consumers match across the five Apps.
Actual preload consumers check Clock, Calendar, Year progress, Pomodoro unavailability, and catalog search.
Ten authenticated restoration and activation operations preserve the document, desktop nodes, Main lifecycle records, provided-port instances, and saved configuration bytes.
Each activation executes one target entry; restoration executes no external entry.
An incorrect signed Clock reading fails the same consumer check.
A signed entry without its Clock definition triggers the packaged fallback guard through actual production loading.
The guard passes syntax validation and requires an initialized counter before navigation.
Normal shutdown removes all observed Main IPC handlers and the native asset protocol.
Computed focus checks now cover Back, catalog search, and Reload in Instrument, Pixel, and Border Beam.
Programmatic and development modes each complete 63 checks; signed revision mode completes 105.
Each check requires keyboard focus, a computed focus marker, viewport containment, and matching default styles and control dimensions.
The hidden browser uses focus emulation and confirms document focus before keyboard input; it does not take desktop focus.
Without that control, the first run retained the active Back element but had no document focus or focus-visible state.
Nine focused checks passed in 31434 milliseconds, including missing-marker rejection in all three loading modes.
These assertions do not establish pixel contrast, density, physical keyboard behavior, or supported-device acceptance.
The current-worktree command passed 125 tests with zero failures or skips in 49345 milliseconds on 2026-10-10.
This built-in App increment is included in the latest completed 2044-test full Shell run.
Production inputs remain unchanged.
The command runs from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/app-manager-main-bootstrap.test.js tests/builtin-view-replacement.test.js tests/app-interiors.test.js tests/app-platform.test.js tests/renderer-development.test.js tests/native-renderer-plugins.test.js tests/native-plugin-loader.test.js tests/native-plugin-cli.test.js tests/native-plugin-manager.test.js tests/renderer-management.test.js tests/renderer-runtime-replacement.test.js
```

### Native built-in App investigation

The first controlled built-in App command ran on Windows x64 and CM5 Linux arm64 on 2026-10-10.
Windows passed all nine checks with zero failures or skips in 31.58 seconds in interactive Session 1.
CM5 passed seven checks and failed two in 147.56 seconds, with zero skips.
The programmatic and signed positive paths reached the existing thirty-second fixture deadline.
All 261 captured source, fixture, helper, and package inputs remained unchanged during both commands.
The Windows acceptance task was removed after terminal confirmation and a task-owned process check.
No task-owned acceptance processes remained on either host.

Two hidden-window regression cases failed before explicit renderer metrics and offscreen rendering were added.
The fixture establishes a 1920 by 1280 viewport and unit scale before interactions.
Linux uses software rendering; focus emulation, behavior assertions, negative controls, and deadlines remain required.
Independent source review found no actionable issue in those rendering changes.
The reviewer did not run checks.
Later diagnostic changes add optional bounded phase timing and forward that output after successful positive checks.
The final local affected command passed 73 checks with zero failures or skips in 34.58 seconds.

A separate programmatic CM5 positive check passed in 30.74 seconds, including child setup and process closure.
This focused pass does not clear the failed complete native command.
A signed CM5 diagnostic check failed again at the same fixture deadline in 32.23 seconds.
Its phase observations reached the default phase at 1.60 seconds, independent at 11.53 seconds, and updated at 21.06 seconds.
Updated App Manager search completed at 29.87 seconds; rollback and restoration were not reached.
The trace shows completed phase work before the deadline, without establishing the cause of its execution cost.
The native command remains unresolved; no deadline or tolerance was increased.

Windows evidence predates the optional diagnostic changes.
It does not certify the final diagnostic candidate or CM5 completion.
Production sources, active releases, and product services did not change.
Physical input, screen presentation, and native CM5 completion remain unverified.

A later controlled CM5 probe measured forty simple calls at 29 milliseconds through Electron and 55 milliseconds through the debugger.
This probe does not measure the complete App workflow or establish its timeout cause.
A separate thirty-frame-per-second experiment still failed the signed path at the original deadline.
The experiment reached rollback selection but did not complete rollback or restoration; its frame-rate change was not adopted.

The final fixture combines focus preparation and measurement in one Renderer call without removing any measurement assertions.
Repeated Backspace events use one observer and one completion wait while retaining every native key pair.
A new regression failed when only one of seven requested key pairs was sent.
Single-key and seven-key regressions now require all releases, the final receipt, observer removal, and one completion wait.
The affected local command passed 75 checks with zero failures or skips in 33.32 seconds.
Fresh independent source review found no actionable issue; the reviewer did not run checks.
Windows repeated all nine checks successfully in 31.57 seconds against this candidate.
CM5 repeated the full command in 141.39 seconds: eight passed, one failed, and zero skipped.
Programmatic and development positive paths passed; the signed positive path still reached its original fixture deadline.
All 261 captured inputs remained unchanged on both hosts and matched the worktree afterward.
The Windows task was removed after terminal confirmation; cleanup checks found no task-owned acceptance processes.
The complete CM5 gate remains failed, and the full Shell command was not repeated after these fixture changes.
A separate experiment removed the Linux GPU-disable argument without changing the formal candidate.
The signed path still failed at its deadline in 32.33 seconds.
Electron reported software GPU compositing and unavailable OpenGL; this experiment did not establish usable hardware acceleration.
Diagnostic-only test files were removed from the private candidate after terminal and process checks; local evidence was retained.


The later budget review identified five signed phases and ten revision commands, compared with three phases in other modes.
The thirty-second aggregate watchdog was a fixture budget, not a product performance contract.
Only signed acceptance now uses sixty, sixty-five, and ninety seconds for fixture, child, and parent deadlines.
Other modes retain thirty, thirty-five, and forty-five seconds; readiness checks retain two seconds, and CLI commands retain ten seconds.
Five new budget regressions failed before implementation; the unchanged programmatic watchdog check already passed.
The affected local command then passed all 81 checks in 33.39 seconds, with no failures or skips.
Fresh independent source review found no actionable issue; the reviewer did not run checks.
The latest Windows and CM5 commands each passed nine behavior checks and six budget regressions, with no failures or skips.
Windows ran in interactive Session 1 and completed in 31.87 seconds; CM5 completed in 161.89 seconds.
The signed CM5 positive path completed all five phases in 52.76 seconds, including setup and closure.
All 262 captured inputs remained unchanged on both hosts and matched the worktree after acceptance.
The Windows task was removed after its terminal receipt; neither host retained task-owned acceptance processes.
These results supersede the failed complete built-in App commands above for this candidate.
They do not establish physical input, screen presentation, or a repeated full Shell command.
Production sources, active releases, and product services did not change in this increment.

Run this affected command from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/builtin-view-timeouts.test.js tests/e2e-isolation.test.js tests/builtin-view-replacement.test.js tests/app-interiors.test.js tests/renderer-runtime-replacement.test.js
```

## Service coordinator replacement evidence

Independent test factories replace service refresh, service notifications, and initial frame status through the existing Main composition selection.
The factories use declared ports and capabilities without invoking packaged factories.
The shared scenarios run selected definitions in the actual Plugin Host with controlled providers, timers, frames, and clients.
Refresh checks use the actual Open DeskOS Data registry and reading consumer.
They cover provider order, failed providers, failed diagnostics, overlapping requests, cancellation, and release before provider shutdown.
Notification checks preserve reading identities, return values, unavailable providers, and retained port behavior after disable.
Frame checks preserve broadcast destinations, initial states, unavailable fallbacks, and retained callback behavior after release.
No runtime source changed in this increment.

The affected command passed 83 tests with zero failures and zero skips on 2026-10-10.
The first fixture attempt selected unrelated Main defaults and lost custom reading dependencies.
The corrected fixture preserves unrelated definitions and selects only the three replacement coordinators.
Independent review repeated all 20 shared coordinator checks and found no actionable issue.
The [joint Main checks](../tests/app-manager-main-bootstrap.test.js) also load all three alternatives through trusted development CLI links.
Entry markers and packaged construction guards verify selection during production Main startup.
The shared scenarios above own detailed refresh, notification, and frame behavior checks.
The joint command passed 123 tests with zero failures or skips in 41594 milliseconds on 2026-10-10.
Live providers and supported-host acceptance remain unverified.

```sh
node --test --test-concurrency=1 tests/service-reading-plugins.test.js tests/system-channel-plugins.test.js tests/desk-runtime-plugins.test.js tests/main-plugin-replacement.test.js tests/plugin-host.test.js tests/plugin-host-replacement.test.js tests/app-manager-main-bootstrap.test.js tests/plugin-diagnostics.test.js
```

## Pi App and page ownership

### Implementation and selection

The packaged Pi App and Page share their original local view function without looking up each other's selected definition.
Their plugin identities remain separate.
Session parsing, filtering, detail rendering, navigation, and source policy retain their existing contracts.
The shared reading entry checks its disposal flag before starting a session scan.
The latest completed full Shell run includes both production repairs.
Subsequent Pi increments change scenarios and fixtures only.

The [browser checks](../tests/pi-electron.test.js) compare default behavior with captured, development-linked, and signed App and Page factories.
The [view helper](../tests/helpers/pi-view-selection.js) builds external entries from the complete Pi module.
These factories share the packaged algorithm; they do not establish independently authored App or Page behavior.
Actual CLI selection, authenticated discovery, preload, and Renderer loaders serve the external entries.
Entry execution markers confirm selection; refusing packaged mounts detect fallback.
Controlled missing Page definitions must fail that guard through the same loading path.

### Current behavior evidence

The shared browser scenarios cover three themes, two sizes, and default and signed independent sources.
They compare session and event states, filters, CJK paths, details, loading, unavailable and malformed responses, and App closure.
Reciprocal checks replace one view with a refusing mount while the other retains its normal behavior.
The actual App Manager and public App platform open and close Apps.

Each selected browser mode includes 24 released Tick checks and 48 delayed-response checks.
Released callbacks start no additional session read requests through actual Main IPC.
Delayed responses leave former nodes and fresh instance readings unchanged after closure and reopening.
These checks hold delivery after source completion; they do not prove cancellation of provider work.

Each mode also includes 24 failed Tick cancellation checks across both view kinds, themes, and sizes.
The fixture observes the tested mount's actual upstream subscription before fault injection.
Failed cancellation retains that subscription while former callbacks start no reads and leave former nodes unchanged.
An explicit close or disable retry releases the same subscription after the fault clears.
Fresh callbacks display changed readings; former callbacks remain inactive after the fresh instance opens.
The fixture retains the fault across Page reconciliation attempts until explicit retry.
App close returns failure; Page disable rejects and exposes its existing cleanup-failed state.
These checks cover Tick ownership and callback permission, not every timer, listener, or provider resource.

### Production composition and revisions

The [Main bootstrap checks](../tests/pi-main-bootstrap.test.js) start every Main plugin with controlled external inputs and actual App and Page consumers.
Four separate processes cover signed version two, version three, rollback, and removal to packaged defaults.
Actual CLI update and rollback preserve other plugin preferences.
Entry-owned version markers distinguish executing bytes from selected declarations.
Unsigned edits to either view are rejected without changing saved configuration bytes.
All four retained signed view revisions remain byte-identical after removal.
Both views preserve the reported Open DeskOS Link path and event through preload and rendered consumers.
Shutdown releases source, App Manager, and discovery IPC handlers and the signed asset protocol route.

Three signed processes also complete twelve authenticated implementation changes and three refusals while the Pi App remains open.
Refusals preserve the foreground App node, App Manager state, Page readings, and saved configuration.
Closing the App permits restoration and later signed activation with matching session and event readings.
Page restoration and activation retain the document, container, and unrelated foreground App across three themes.
Activation executes only the requested Pi entry and confirms its version.
Successful operations preserve saved configuration bytes and every Main provided-port instance.

Earlier production checks contained invalid JavaScript in their default-mount observation.
A zero fallback concealed its missing execution; those runs do not establish the production default-mount guard.
The current guard passes syntax validation and requires an initialized counter before startup assertions.
A missing signed Page definition fails that guard through actual production loading.

### Results and remaining limits

The latest affected command passed 206 tests with zero failures or skips in 105530 milliseconds on 2026-10-10.
It includes the corrected guard and failed Tick cancellation checks.
All Pi App and Page increments are included in the latest completed 2133-test full Shell run.
Production inputs remain unchanged from that snapshot.
The earlier released Tick repair also received independent review with 32 focused checks and no actionable findings.
The command runs from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/pi-electron.test.js tests/pi-main-bootstrap.test.js tests/pi-sessions-remote-ui.test.js tests/pi-tile-surface-lifecycle.test.js tests/pi-status-surface-lifecycle.test.js tests/pi-sessions.test.js tests/pi-source-lifecycle.test.js tests/app-platform.test.js tests/renderer-runtime-replacement.test.js tests/renderer-development.test.js tests/development-plugins.test.js tests/native-renderer-plugins.test.js tests/native-plugin-loader.test.js tests/renderer-management.test.js tests/native-renderer-activation.test.js
```

Live providers, physical input, density, pixel comparisons, and supported-host acceptance remain unverified.
Failed cleanup checks cover Tick cancellation and retry; they do not establish arbitrary Pi view cleanup-failure recovery.
Additional lifecycle work requires a named feature scenario that current selection, delayed response, release, and cancellation checks cannot cover.

## Native Main management and Appearance acceptance

The existing Main checks ran on CM5 with private configuration, state, workspace, endpoints, temporary files, and Electron profiles.
The initial command passed nine checks and failed two Appearance cases; all 673 captured inputs remained unchanged.
All eight App Manager checks passed, including startup selection, state recovery, installed desktop entries, built-in Apps, and selected diagnostic consumers.

A bounded observation retained the original 45-second fixture deadline and the actual production verifier.
Package verification completed in approximately 1.2 seconds.
The hidden-window measurements continued across themes and revisions until the complete comparison exceeded that deadline.
Observed frame waits took approximately two to three seconds each.
This observation explains the current fixture deadline failure, not earlier production verifier timeouts.

The Appearance fixture now uses fixed Linux arm64 deadlines of 90, 100, and 110 seconds for fixture, child, and test.
Other platforms retain their 45, 55, and 65-second deadlines.
Production verification, eight-second and four-second reading waits, ten-second CLI operations, and behavior assertions remain unchanged.
Four platform deadline regressions failed before the repair and passed afterward.
No product source changed.

The final affected command passed all 95 checks locally in 36328 milliseconds and on CM5 in 230350 milliseconds.
Both commands had zero failures or skips and retained all 673 captured inputs unchanged.
No task-owned acceptance process remained on CM5 after completion.

Run this command from `runtime/shell/` with private host paths:

```sh
node --test --test-concurrency=1 tests/e2e-isolation.test.js tests/app-manager-main-bootstrap.test.js tests/appearance-main-bootstrap.test.js
```

The checks retain actual Main selection, authenticated management, installed desktop consumers, and built-in App consumers.
Selected diagnostic and management owners exercise inventory, health, discovery, and actual CLI disable and enable operations.
External runtimes use controlled unavailable inputs.
Appearance checks compare three themes across signed activation and default restoration while retaining the installed sandboxed App and counter state.
A separate controlled package rejection checks the existing failure response and resource release.

Live providers, physical input, physical screen presentation, and remaining Appearance consumer scenarios remain unverified.
Windows execution remains separate; this increment follows the user's request to test CM5 first.
Production services and the active release did not change.

## Native Pi App and Page acceptance

The existing browser and production Main checks ran on CM5 with private configuration, state, workspace, endpoints, and Electron profiles.
The initial command passed three checks and failed seven; all 673 captured inputs remained unchanged.
Both production Main checks passed, including signed revisions, runtime operations, and the missing Page guard.
Browser checks exceeded their fixture or child deadlines before completing the intended comparisons or guards.

The browser fixture now renders offscreen and selects software rendering on Linux before readiness.
A control with those changes still exceeded the unchanged deadlines while reaching later signed-view stages.
A single captured-view observation then completed in 80 seconds with a bounded 150-second diagnostic deadline.
It retained 24 released-view, 48 delayed-response, and 24 failed-release checks.
The temporary observation entry was removed after its recorded hash matched.

The [existing view helper](../tests/helpers/pi-view-selection.js) now owns fixed Linux arm64 matrix budgets.
The fixture, child, and positive test deadlines are 150, 160, and 180 seconds.
Negative child and test deadlines are 60 and 65 seconds, allowing the default matrix to precede the selected-entry guard.
Other platforms retain their existing deadlines.
Four-second reading waits, ten-second CLI operations, and all behavior assertions remain unchanged.
Eight rendering and deadline regressions failed before their repairs and passed afterward.

The final affected command passed all 90 checks locally in 98818 milliseconds and on CM5 in 440222 milliseconds.
Both final commands retained all 673 captured inputs unchanged.
No task-owned acceptance process remained on CM5 after completion.
Product sources and production services did not change.

Run this command from `runtime/shell/` with private host paths:

```sh
node --test --test-concurrency=1 tests/e2e-isolation.test.js tests/pi-electron.test.js tests/pi-main-bootstrap.test.js
```

These results retain the [view ownership limits](#pi-app-and-page-ownership), including shared algorithms and controlled external inputs.
Live reporters, density, raster pixels, physical input, and physical screen presentation remain unverified.
Windows execution remains separate; this increment follows the user's request to test CM5 first.

## Pi Widget independent replacement

The [independent Widget](../tests/fixtures/pi-tile-surface-replacement/entry.js) uses the existing scan endpoint, shared Tick, Cell rule, and Shell styles.
It implements its own reading projection, formatting, scan sequencing, and resource ownership without packaged mount delegation.
Default and independent implementations share the existing reading, unavailable, late completion, and slow scan scenarios.
Actual registry checks cover replacement on the same placement and retained callbacks after release.
A failing regression showed that a released packaged size callback could still change summary visibility.
The packaged callback now checks its existing disposal flag before reading the Cell or updating the summary.
Failed observer disconnection retains cleanup ownership while revoking update permission; a later retry releases the observer.

The [browser check](../tests/pi-tile-surface-electron.test.js) uses the actual Shell, preload, registry replacement, and default restoration in one document.
Seven states across three themes and two sizes produce 84 replacement and restoration comparisons.
These comparisons include reading text, goal and activity formatting, state classes, hidden state, and retained placement.
A deliberately incorrect replacement count fails the same check.
The same browser fixture also loads a trusted directory linked through the existing CLI and isolated configuration.
Actual Main discovery restricts entries to the Shell frame; the existing Renderer loader executes the linked browser entry.
Private execution and mount markers prove startup selection and mounting before default restoration.
An incorrect external count fails the startup reading assertion.
Both loading modes repeat the same 84 behavior comparisons.
Shutdown removes the authenticated discovery handler; a final preload request confirms it is unavailable.
The Clock peer remains mounted, and final shutdown releases observed Tick subscriptions.
The latest affected command passed 62 tests with zero failures and zero skips in 12360 milliseconds.
Independent review confirmed startup mount markers, final browser results, and unavailable discovery after shutdown.

```sh
node --test --test-concurrency=1 tests/pi-tile-surface-electron.test.js tests/pi-tile-surface-lifecycle.test.js tests/pi-sessions-remote-ui.test.js tests/renderer-development.test.js tests/renderer-runtime-replacement.test.js
```

Independent Pi App and page implementations, pixel comparison, density, live reporters, and supported-host acceptance remain unverified.
These checks do not establish Native distribution or complete production Main composition.

## Native Pi Widget acceptance

The existing [browser check](../tests/pi-tile-surface-electron.test.js) ran on CM5 with private configuration, state, workspace, and Electron profiles.
The initial command passed both incorrect-count rejection cases but failed both positive cases at the unchanged thirty-second fixture deadline.
All 673 captured inputs remained unchanged during that command.

The fixture now renders offscreen and selects software rendering on Linux before application readiness.
Four isolation regressions failed before these two fixture changes and passed afterward.
An isolated CM5 control then passed all four browser cases in 33949 milliseconds.
The final affected command passed all 96 checks locally in 10978 milliseconds and on CM5 in 35191 milliseconds.
Both final commands retained all 673 captured inputs unchanged.
No task-owned process remained on CM5 after the final command.

The positive cases retain 84 behavior comparisons per loading mode across seven states, three themes, and two requested sizes.
They retain actual preload, trusted development discovery, independent selection, default restoration, retained placement, and subscription release assertions.
The negative cases still reject incorrect replacement counts.
The thirty-second fixture, thirty-five-second child, and forty-five-second test deadlines remain unchanged.
Product sources and production services did not change.

Run this command from `runtime/shell/` with private host paths:

```sh
node --test --test-concurrency=1 tests/e2e-isolation.test.js tests/pi-tile-surface-electron.test.js tests/pi-tile-surface-lifecycle.test.js tests/pi-sessions-remote-ui.test.js
```

These results cover controlled Widget readings and DOM state, not density, raster pixels, live reporters, or physical input and display.
Windows Widget execution remains pending while that host is offline.
Pi App, Page, and production Main host acceptance retain their separate requirements.

## Compatibility requirements

The existing feature scenarios remain the acceptance contract.
Each feature needs evidence for its default implementation, unavailable dependencies, disable operations, and replacement behavior.

A parity check must preserve these externally visible contracts:

- IPC channels, protocol payloads, error states, and acknowledgement guards
- Reading identities, provenance, values, units, and availability policies
- Package revisions, published values, preferences, and saved placement
- Touch, keyboard, Remote input, App navigation, and the Back path
- Authorization, uncertain operation outcomes, and mutation replay rules
- Resource ownership, shutdown order, cleanup retries, and independent failure recovery

An accepted port set proves declaration compatibility only.
It does not prove method signatures, interaction behavior, or data correctness.
Retained legacy Camera ports remain accepted without claiming undeclared health.
A replacement cannot authorize its own compatibility exceptions.

## Evidence refreshed in this audit

These checks ran against the local tree on 2026-10-08.
All listed processes completed successfully.
The results do not establish full repository, deployed, or hardware acceptance.

| Check | Command | Result |
| --- | --- | --- |
| Shell plugin composition and replacement | `node --test tests/renderer-plugin-host.test.js tests/appearance-plugins.test.js tests/plugin-composition.test.js tests/main-plugin-replacement.test.js tests/development-plugins.test.js` | 40 passed |
| Personal Bot and Hosted Pi composition | `node --test tests/plugin-composition.test.mjs tests/task-composition.test.mjs tests/task-daemon-construction.test.mjs` | 14 passed |
| Remote Bridge lifecycle | `node --test integrations/remote-bridge/test/plugin-lifecycle.test.js` | 9 passed |
| Futu Python | `uv run --with pytest pytest -q integrations/futu-poller/tests -W error::RuntimeWarning` | 64 passed |
| Native Host and peripheral fixtures | `uv run --with pytest pytest -q peripherals/common/tests peripherals/esp32-s3-remote/tests peripherals/esp32-p4-camera/tests` | 24 passed |

The Shell command runs from `runtime/shell/` through `corepack pnpm@11.22.0 exec`.
The Bot command runs from `integrations/personal-bot/` through the same package manager.
The remaining commands run from the repository root.
Native checks compile host fixtures and inspect source wiring.
They do not refresh ESP-IDF target builds or access physical peripherals.

### Main diagnosis startup selection

The [shared diagnosis checks](../tests/plugin-diagnostics.test.js) run thirteen scenarios against default and selected Main implementations.
The [alternative](../tests/fixtures/main-diagnostics-replacement.js) owns endpoint lifetime, report projection, health validation, and runtime aggregation.
It reuses the authenticated transport and public runtime sanitizer without calling the default diagnosis factory.
Existing Main composition selects the alternative and guards default factory execution.
Public and CLI consumers preserve plugin states, exit codes, health ownership, component bounds, and private-field exclusion.
Invalid asynchronous health values remain contained without unhandled rejections.
Valid runtime reports retain declared host and instance identity; invalid reports remain unavailable.
Diagnosis disable and enable release the endpoint while preserving independent runtime providers.
The affected command passed 66 tests with zero failures or skips in 10827 milliseconds.

The first new restart checks incorrectly expected returned refusal objects; the shared client rejects these requests.
Corrected expectations preserve the existing client contract.
An existing Electron child also reported success but exceeded its exit timeout in the initial affected run.
The complete affected command passed after correction without changing Electron deadlines or assertions.
The earlier exit timeout's cause remains undetermined.

```sh
node --test --test-concurrency=1 tests/plugin-diagnostics.test.js tests/plugin-runtime-report.test.js tests/renderer-diagnostics.test.js tests/main-plugin-replacement.test.js tests/plugin-control.test.js
```

Run the command from `runtime/shell/`.
The [joint Main check](#external-runtime-diagnosis-replacement) subsequently loaded this alternative through actual trusted development CLI links.
It compares Main health values with their current providers and requires matching public and CLI reports.
Supported-host operator acceptance remains unverified for this alternative.
No production source or interface changed.

### Renderer diagnosis verification

Default and selected Renderer diagnosis checks completed on 2026-10-10 with 68 affected tests passing and no failures or skips.
The [alternative fixture](../tests/fixtures/renderer-diagnostics-replacement.js) owns request correlation, frame checks, limits, timers, cancellation, and listener cleanup.
It shares the existing report sanitizer without calling the default diagnosis factory.
The [shared checks](../tests/renderer-diagnostics.test.js) select this factory through Main composition and exercise public ports and the actual CLI.
Both implementations reject incorrect senders, invalid manifests, duplicate identities, and oversized reports without publishing private errors.
Disable cancels pending probes and removes the listener; enable creates a fresh provider using the same frame.
Retained providers and old replies cannot restart released work.
Unit checks use controlled frames.
The [Electron fixture](../tests/renderer-diagnosis-electron.cjs) also selects the same alternative through Main composition and uses actual IPC, preload, and registry state.
Public and CLI reports match; diagnosis restart preserves the Renderer catalog, document, and mounted nodes.
The missing-selection case fails its version check; shutdown removes the IPC listener and local diagnosis endpoint.
The CLI preserves absent startup preferences while each request retains its own protocol identity.
Existing default and Renderer control fixture modes also passed separately.
These Electron checks use controlled source channels and private state without physical device access.
Read [joint production Main verification](#external-runtime-diagnosis-replacement) for the subsequent actual startup selection and CLI evidence.
No production interface or implementation changed for this verification.

Run this command from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/renderer-diagnostics.test.js tests/plugin-diagnostics.test.js tests/plugin-control.test.js tests/main-plugin-replacement.test.js tests/plugin-runtime-report.test.js tests/renderer-control-bridge.test.js tests/main-smoke.test.js
```

Earlier default Renderer diagnosis checks ran on 2026-10-08.
The real Electron diagnosis fixture reported 30 renderer plugins and selected the Weather identity through the authenticated channel.
The fixture used temporary data and mocked source channels without camera or microphone capture.
The release smoke check reported a 1920 by 1280 window and exited successfully.
Regression checks cover destroyed-window cleanup, response identity, concurrent requests, frame limits, oversized reports, and shutdown cancellation.
Independent source review found no remaining issues in these changes.
These results do not establish visual, interaction, deployed, or physical-device acceptance.

### Resident Personal Bot diagnosis verification

The resident diagnosis checks also ran on 2026-10-08.
The complete Shell test command passed 929 tests, skipped two tests, and reported no failures.
The complete Personal Bot test command passed 523 tests, skipped two tests, and reported no failures.
Personal Bot type checking passed.
The actual local CLI reported failure for a failed resident Agent plugin without exposing its private error.
Six resident diagnosis tests covered authentication refusal, unavailable snapshots, cancellation, response identity, and compatibility.
Older residents received no unknown diagnosis commands.
Older clients retained their existing status frames and message bounds.
The real Electron renderer fixture still reported 30 plugins and explicitly reported the absent resident provider as unavailable.
Independent source review found no remaining issues in negotiation, request ownership, or report validation.
All resident checks used temporary local channels and injected resources without Agent, recording, or transcription work.
These results do not establish deployed Bot, real-model, Windows-device, or CM5 acceptance.

### Remote Bridge diagnosis verification

The Bridge diagnosis checks also ran on 2026-10-08.
The complete Shell test command passed 934 tests, skipped two tests, and reported no failures.
The complete Remote Bridge test command passed 38 tests without failures.
The actual local CLI reported failure for a failed transport plugin without exposing its private error.
Both bridge entry points returned their actual listener and transport states.

Regression checks covered disabled transports, old bridges, cancellation, request limits, response identity, invalid reports, and oversized responses.
Responder checks covered private metadata, asynchronous rejection, invalid commands, and queued write limits.
The original default client startup order and input protocol remained unchanged.
Independent source review found no remaining issues and independently passed nine diagnosis checks.
All Bridge checks used temporary sockets and injected transports without hardware discovery or physical input.
These results do not establish deployed Bridge, physical transport handover, Windows-device, or CM5 acceptance.

### External runtime diagnosis replacement

Four independent test factories replace Personal Bot, Remote Bridge, Hosted Pi, and Futu diagnosis through existing Main selection.
They own report projection, protocol adaptation, and cancellation forwarding without calling the packaged diagnosis factories.
Personal Bot and Remote Bridge retain their existing clients; Hosted Pi retains the shared transport probe.
The Futu diagnostic factory retains the owned source and actual Python publisher.
These checks establish diagnosis plugin replacement; they do not establish independent replacement of clients, probes, or transports.

Shared consumers exercise public diagnosis and CLI requests, current runtime states, private-error exclusion, and existing control behavior.
Cases cover absent and legacy providers, failed probes, cancelled requests, retained ports, and fresh signals after enable where applicable.
Remote Bridge diagnosis shutdown leaves its existing client able to request the active bridge catalog.
The actual Python publisher remains live for both selected and default diagnostic consumers.

Production Main selects these four alternatives, Main diagnosis, Renderer diagnosis, discovery, management, and control through trusted development CLI links.
The same fixture also selects service refresh, service notifications, and frame status.
Every Main plugin runs with controlled external inputs; entry markers identify the twelve selected modules.
Public and CLI runtime reports match default startup, including the independent Renderer inventory.
Each Main health report matches its declared provider's current snapshot before comparison across processes.
Cross-process comparisons check health states, reasons, components, and timestamp presence because acquisition times differ.
Public and CLI reports also match complete Main plugin and health records within each process.
Management inventory preserves declared ownership; actual CLI runtime disable and enable restart the selected Frame Status plugin.
Notification publication preserves the unavailable Agent client's false return value.
Requests preserve Main lifecycle records, provided-port instances, App state, desktop nodes, and saved configuration bytes.
The fixture repeats existing Back, Escape, and App recovery scenarios after diagnosis.
A missing Futu, management, Main diagnosis, Renderer diagnosis, discovery, or control selection fails its packaged construction guard during actual startup.
Separate missing-selection checks cover service refresh, service notifications, and frame status.
The actual preload discovery consumer returns the same empty entry list before and after disable and enable.
Requests fail while discovery is disabled; the document and mounted nodes remain unchanged.
Renderer control inventory returns after its own disable and enable cycle.
Actual CLI commands disable and enable Pixel Appearance without changing the restored theme or saved selection.
Normal shutdown removes Main handlers, Renderer report listeners, and diagnosis, management, and Renderer control endpoints.

The [service coordinator section](#service-coordinator-replacement-evidence) records the current joint command and its 123 passing tests.
No production source changed.
The [current status](#scope-and-status) records full-run coverage and the later verification changes.
Live external providers, Windows named pipes, deployed runtimes, and supported-device acceptance remain unverified.

### Hosted Pi diagnosis verification

The Hosted Pi diagnosis checks also ran on 2026-10-08.
The complete Shell test command passed 938 tests, skipped two tests, and reported no failures.
The complete Personal Bot test command passed 524 tests, skipped two tests, and reported no failures.
Personal Bot type checking passed.
The real Electron fixture reported 30 renderer plugins and distinguished absent resident and Hosted Pi providers.
The release smoke check reported a 1920 by 1280 window and exited successfully.

The actual local CLI selected `odk.hosted-pi.service` from the task composition.
Task list requests remained available after the diagnosis provider stopped.
Regression checks covered initialization, endpoint discovery, cancellation, named instances, invalid UUIDs, and old-service refusal.
The old-service fixture retained ordinary task control and excluded its private error from diagnosis.
Independent source review confirmed request validation and unchanged fixture behavior.

All checks used temporary local channels and injected resources without Agent work or live capture.
These results do not establish deployed Hosted Pi, real-model, Windows-device, or CM5 acceptance.

### Weather replacement verification

The Weather replacement checks also ran on 2026-10-08.
The complete Shell test command passed 949 tests, skipped two tests, and reported no failures.
The focused source, location, source-plugin, and replacement commands passed 53 tests without failures.
The real Electron diagnosis fixture reported 30 renderer plugins and exited successfully.
The release smoke check reported a 1920 by 1280 window and exited successfully.
Independent review confirmed the shared acceptance coverage and cancellation fixes.

The [shared checks](../tests/weather-plugin-parity.test.js) run against the default factory and an independently linked CommonJS fixture.
The fixture loads through the actual CLI and development loader, using temporary configuration.
It reuses the existing Weather provider library without invoking the built-in plugin factory.
This establishes a local replacement boundary, not compatibility with another weather provider.

Both factories preserve IPC payloads, Open DeskOS Data identities and values, four availability states, and cached health without provider requests.
Both reload persisted readings after disable and enable operations.
Both drain cancellation before replacement and retain resources after failed cleanup until retry succeeds.
Removing the link preserves its source package and permits the default factory to start again.

Regression tests first reproduced provider acquisition and location cache publication after cancellation.
The fixes cancel owned requests and suppress late cache writes or update callbacks.
All requests use injected fixtures without external provider, location, camera, or microphone access.
These results do not establish rendered replacement UI, deployed packages, Windows-device, or CM5 acceptance.

### Renderer replacement verification

The renderer replacement checks also ran on 2026-10-08.
The complete Shell test command passed 958 tests, skipped two tests, and reported no failures.
The focused registry and App transition checks passed 24 tests without failures.
The release smoke check reported a 1920 by 1280 window and exited successfully.

The real Electron fixture selected a replacement Clock factory and mounted one Clock with the existing display-only role.
Its runtime catalog reported the selected version, and shutdown unmounted the Clock before stopping its factory.
The invalid-kind fixture reproduced failed Shell composition before the fallback fix.
The final fallback fixture restored the default Clock and retained the disabled Camera identity.

Shared style checks passed in an isolated local profile.
The density fixture passed five standard viewport sizes with no violations or report-only mode.
The complete interaction command passed its driver, motion, geometry, style, sequential-state, six density, and seven theme subchecks.
Independent source review confirmed replacement contract checks, retained element ownership, ordered App transitions, and failed-mount recovery.
The App recovery regression uses the real registry and actual App endpoint contract.

Replacements retain identity, surface role, App routing, ports, dependencies, permissions, and the Minimum Readable Cell declaration.
Registry validation occurs before factory execution and preserves the original composition on rejection.
Surface cleanup prevents element reuse until release completes.
Failed activation waits for retained cleanup before restoring the previous foreground and endpoint state.

The fixture supplies trusted definitions before startup through the actual Shell composition.
It does not establish a production package loader, remote distribution, sandbox, or runtime hot replacement.
All checks use injected sources and hidden local windows without live capture or production credentials.
These results do not establish CM5, Windows-device, physical input, or assistive-technology acceptance.

### Renderer development link verification

The renderer development checks also ran on 2026-10-08.
The release smoke check reported a 1920 by 1280 window and exited successfully.
The focused loader, registry, configuration, development, and Main replacement checks passed 52 tests without failures.
The complete Shell test command passed 963 tests, skipped two tests, and reported no failures.

The actual CLI records renderer links without executing browser entries in Main.
The real Electron fixture loaded a linked Clock under the existing Content Security Policy.
A second Electron fixture registered the replacement and then threw from its entry.
The Shell restored one default Clock with its existing role and did not execute the failed replacement factory.
Both fixtures used the actual preload, authenticated entry provider, development loader, registry, and Shell composition.
The complete interaction command exited successfully with no driver, motion, geometry, style, sequential-state, or Hydra failures.
Its six density runs each passed five standard viewport sizes without violations or report-only mode.
Its seven theme subchecks also exited successfully.

Regression checks cover declaration preflight, exact identity registration, duplicate definitions, runtime errors, and definition compatibility.
They also cover trust, grants, disabled identities, host separation, entry size, missing files, and removal without source deletion.
Known main frames can request entries; unknown windows and child frames cannot.
Independent review found no blocking source issue and identified the previous documentation gap and remaining package asset boundary.
The documentation distinguishes Main factories, renderer browser entries, and their separate asset contracts.

These links load trusted mutable code at startup.
They do not provide a sandbox, signed distribution, revision rollback, or runtime hot replacement.
All fixtures use temporary configuration, hidden local windows, and injected sources without live capture or production credentials.
CM5, Windows-device, physical input, and assistive-technology acceptance remain unverified.

### Renderer package stylesheet verification

The renderer stylesheet checks also ran on 2026-10-08.
The release smoke check reported a 1920 by 1280 window and exited successfully.
The complete interaction command exited successfully with no driver, motion, geometry, style, sequential-state, or Hydra failures.
Its six density runs each passed five standard viewport sizes without violations or report-only mode.
Its seven theme subchecks also exited successfully.
The focused loader, registry, styles, configuration, development, and replacement commands passed 61 tests without failures.
The complete Shell test command passed 967 tests, skipped two tests, and reported no failures.

The real Electron linked Clock fixture loaded a package stylesheet and measured its declared CSS property on the actual Widget.
The stylesheet added a test marker without changing the existing Clock layout or interaction role.
An unavailable-stylesheet fixture removed its owned CSS file after Main validation.
The renderer rejected the package before entry execution and restored the default Clock without the package CSS property.
The entry-failure fixture also restored the default Clock without applying the staged stylesheet.

Main validates the optional stylesheet path after realpath resolution and enforces a 256 KiB limit.
The loader checks stylesheet availability with inactive media before executing entries.
Temporary links are removed on success, failure, or timeout.
A deterministic timeout regression checks link removal, timer release, and exclusion of entry execution.
The registry associates validated file URLs with individual selected definitions.
Ordinary relative CSS declarations and their injection order remain unchanged.
Independent source review found no material issue in path validation, authority, cleanup, or fallback.

The existing Content Security Policy remains unchanged.
CSS resource URLs resolve from the stylesheet location; recursive asset validation remains unfinished.
These trusted development links do not provide third-party isolation or production distribution.
All checks use temporary configuration, hidden local windows, and injected sources without live capture or production credentials.
CM5, Windows-device, physical input, and assistive-technology acceptance remain unverified.

### Futu Python operator verification

The Python operator checks also ran on 2026-10-08.
The complete Futu test command passed 69 tests with RuntimeWarning treated as an error.
Independent review passed 14 operator and composition checks and found no material issue.

The [operator commands](../../../integrations/futu-poller/README.md#operator-inspection-and-startup-selection) list declarations or validate the dependency graph without starting providers.
Subprocess checks supply private credentials, private endpoints, and an invalid provider port in the environment.
Inspection ignores those operational values and reports only the unstarted `python-agent` composition.
Its explicit `declarations` scope does not claim live runtime discovery or health.

Startup selection accepts explicit disabled component identities and rejects unknown identities before factory execution.
The disabled-gateway check excludes the SDK factory, blocks its required loop, and preserves independent publisher cleanup.
The no-argument command still starts the operational composition.
Existing tests retain protocol records, market order, authentication behavior, polling intervals, and resource ownership.

Inspection and invocation disables do not update saved preferences or manage another running process.
Live Python diagnosis, alternative SDK implementations, deployed services, Windows-device, and CM5 acceptance remain unverified.
All checks use local subprocesses and injected providers without production credentials, real SDK access, or production channels.

### Futu Python saved preference verification

The saved preference checks also ran on 2026-10-08.
The complete Futu test command passed 79 tests on macOS with RuntimeWarning treated as an error.
The same 79 tests passed in a Python 3.13 Linux container with external networking disabled and source mounted read-only.
The task-owned container image was removed after verification.
The complete Shell test command passed 967 tests, skipped two tests, and reported no failures.
The configuration inventory checks passed after adding the optional preference setting.
Independent source review found no blocking behavior, security, or concurrency issue.

The actual CLI saves enable and disable preferences without consuming provider settings or starting factories.
It reports the `preferences` scope and explicitly applies changes at the next startup.
Saved preferences and invocation disables combine before factory execution.
An invalid selected file fails before providers start.
The no-configuration startup and copied CLI retain their existing behavior and protocol output.

Regression checks cover component preservation, private file mode, unknown identities, duplicate keys, bounds, malformed values, and failed replacement.
An event-controlled writer test verifies lock refusal, lock ownership, and preservation of two independent selections after retry.
A symlink alias shares its target lock and remains a symlink after the target update.
The [configuration module](../../../integrations/futu-poller/plugin_config.py) owns the bounded schema and atomic local writes.
The [operator guide](../../../integrations/futu-poller/README.md#saved-component-preferences) owns command use and startup selection.

These checks do not establish live process control, unified runtime discovery, Windows ACLs, or power-loss durability.
Real SDK, external gateway, deployed service, Windows-device, and CM5 acceptance remain unverified.
All requests and writes use temporary files and injected providers without production credentials or production channels.

### Futu Python runtime report verification

The local runtime report checks ran on 2026-10-08.
The complete Futu test command passed 91 tests on macOS with RuntimeWarning treated as an error.
The same 91 tests passed in a Python 3.13 Linux container with Node.js 24 available for the actual Shell validator.
The container used read-only source mounts and disabled external networking during tests.
The task-owned container image was removed after verification.
The affected Shell host and diagnosis checks passed 43 tests without failures.
Independent source review passed 42 host and diagnosis tests and found no remaining material issue.

The report reads the actual owned composition without factories, provider calls, cleanup, or network operations.
Checks cover registered, running, disabled, blocked, failed, stopped, and cleanup-failed states.
Returned data remains isolated from host records and excludes private errors, capability values, and extra manifest fields.
Undeclared health remains unknown.
The actual Shell runtime validator accepts the Python report.

Regression checks reject oversized scalar values before copying or encoding.
They also cover UTF-8 byte counts, the combined component budget, and excessive component counts before encoding.
The shared declaration checks reject Boolean schema versions and non-ASCII semantic version digits before factory execution.

This synchronous API requires the owning thread between lifecycle operations.
It does not provide an operator channel, remote listener, or live CLI diagnosis.
Alternative SDK, external gateway, deployed service, Windows-device, and CM5 acceptance remain unverified.
The [Futu guide](../../../integrations/futu-poller/README.md#local-component-plugins) owns the API limits.

### Futu Python replacement contract verification

The replacement contract checks ran on 2026-10-08.
Three failing regression checks reproduced acceptance of components without their required callable operations.
The composition now rejects these components before polling and registers their cleanup before validation.
Unauthenticated startup still excludes the gateway factory and SDK initialization.
Existing lifecycle fixtures now supply the operations required by their declared ports.

The complete Futu test command passed 102 tests on macOS and Linux with RuntimeWarning treated as an error.
Linux used Python 3.13, read-only source mounts, and disabled external networking during tests.
The task-owned image was removed after verification.
Independent review passed 47 related contract checks and 20 composition and gateway parity checks without failures.

The [shared gateway scenarios](../../../integrations/futu-poller/tests/test_gateway_parity.py) run against the default gateway and an independently loaded replacement module.
Both implementations retain nonempty holdings, totals, protocol identity, timestamps, intervals, failure recovery, authentication exclusion, and disable behavior.
The replacement fixture calls neither the built-in gateway nor its polling calculation.
The default gateway consumes synthetic SDK inputs through its existing query and calculation paths.
The publisher emits actual protocol v1 JSON through stdout.

Callable validation does not prove method signatures or alternative implementation behavior outside these scenarios.
These checks do not establish a production loader, real gateway, desktop channel, deployed service, Windows-device, or CM5 acceptance.
Operator channel diagnosis and unified management remain unfinished.

### Futu Python factory result verification

The factory result checks ran on 2026-10-08.
Twelve failing regression checks reproduced asynchronous factory results bypassing the synchronous host boundary through the poller adapter.
The adapter now uses the same result check as host lifecycle operations before it inspects or publishes component resources.
It closes unstarted native coroutines without running their bodies.
It rejects custom awaitables without calling their arbitrary cleanup methods.
Factory context cleanup remains owned by the host and executes once.

Completed Future failures are consumed immediately.
Pending Future failures are consumed through callbacks without waiting for or cancelling work.
Six additional adapter checks cover late thread and asyncio Future failures across all three components.
Asyncio callback checks dispatch the owning event loop without timed waits.

The complete Futu command passed 120 tests on macOS and Linux with RuntimeWarning treated as an error.
Linux used Python 3.13, read-only source mounts, and disabled external networking during tests.
The task-owned image was removed after verification.
Independent source review passed 75 related checks and a separate pending Future probe without material findings.
The [factory result tests](../../../integrations/futu-poller/tests/test_factory_results.py) own adapter regression coverage.

These results preserve synchronous component behavior and the existing local replacement scenarios.
They do not establish asynchronous plugin support, concurrent lifecycle operations, production loading, real gateway behavior, or device acceptance.

### Native lifecycle snapshot verification

The native snapshot checks ran on 2026-10-08.
A failing C fixture reproduced the missing snapshot API before implementation.
The native host now copies public lifecycle fields into caller-owned storage without heap allocation or driver callbacks.
Resource ownership and completed stop and destroy phases retain their actual host meanings.
Identity and name borrow immutable descriptor strings with their declared lifetime.
Snapshots exclude configuration, resource, and lifecycle pointers.

The fixture covers registered, running, disabled, blocked, and failed states, retained providers, failed destroy, and cleanup retry.
It also checks capacity queries, unchanged output after failure, transition refusal, 16 components, invalid counts, and copied field isolation.
Independent source review passed both native host fixtures without material findings.
The complete common, S3, and P4 host commands passed 25 tests on macOS and Linux.
C fixtures compiled with warnings treated as errors.
The Linux run used read-only source mounts and disabled external networking during tests.
The task-owned image was removed after verification.

Linux GCC initially rejected two existing USB fixture lines for misleading indentation.
Splitting those statements preserved their control flow and retained strict warning checks.
Both platform commands passed after that fixture correction.
The [native host guide](../../../peripherals/common/README.md#local-lifecycle-snapshots) owns API use and lifetime requirements.

These results do not establish JSON report serialization, a firmware operator channel, concurrent access, or hardware health.
ESP-IDF target builds, physical input, camera, microphone, USB, and DMA acceptance remain unverified in this increment.

### Native runtime report verification

The native runtime report checks ran on 2026-10-08.
Two failing compiled fixtures reproduced the missing report API before implementation.
The generator now retains public manifest JSON and host metadata alongside existing native descriptor fields.
Source semantic versions remain available without changing the existing numeric descriptor version.
Manifest and port metadata use explicit public field lists.
An independent pre-fix probe reproduced private port field leakage; the current generator excludes those fields.

The serializer reads actual lifecycle snapshots without driver callbacks or heap allocation.
It uses a 16 KiB byte budget and a fixed snapshot array.
Capacity queries report byte size without the terminating NUL.
Insufficient capacity, invalid state, transitions, missing metadata, and oversized reports leave output unchanged.
Legacy descriptors without report metadata retain lifecycle support and return `ESP_ERR_NOT_FOUND` for report requests.

The actual S3/P4 manifests generated compiled reports for registered, running, and stopped states.
The actual Shell report validator accepted those reports with source versions, escaped names, ports, optional dependencies, and permission names.
Unknown health remained unknown.
The complete common, S3, and P4 host commands passed 27 tests on macOS and Linux.
Independent review passed the same 27 tests and additional exact-budget C probes without remaining material findings.
Linux used Python 3.13, GCC, Node.js 24, read-only source mounts, and disabled external networking during tests.
The task-owned image was removed after verification.
The [native report guide](../../../peripherals/common/README.md#generated-runtime-reports) owns API bounds and metadata requirements.

Firmware operator transport, endpoint discovery, ESP-IDF target builds, and physical S3/P4 acceptance remain unverified in this increment.
These reports do not provide concurrent access or certify driver health.

### ESP-IDF target build verification

Both native target builds ran on 2026-10-10 with the installed ESP-IDF 6.0.1 environment.
The commands used independent temporary copies of current sources, SDK configuration, dependency locks, and managed components.
They did not use existing project build outputs or write generated files into the source projects.
Each copied project ran `eim run 'idf.py build' v6.0.1` and completed with exit code zero.

| Target | ELF architecture | App bytes | Smallest app partition | Free space |
| --- | --- | ---: | ---: | ---: |
| ESP32-S3 Remote | Xtensa | 274560 | `0x177000` | 82% |
| ESP32-P4 Camera | RISC-V | 585648 | `0x600000` | 91% |

Both builds generated six plugin descriptors with public manifest metadata.
Their target objects contain the native host initialization, lifecycle snapshot, and JSON report functions.
Both builds captured 5807 firmware, tool, configuration, lock, managed dependency, and test inputs.
A fresh comparison found changes only in the S3 behavior scenario and consumer test.
All captured production, tool, configuration, lock, and managed dependency inputs still match the current worktree byte for byte.
Both retained app binaries still match the hashes below.
Both builds preserved those copied inputs.
Both image creation and partition size checks passed.
Temporary evidence retains app, bootloader, and partition binaries with SHA-256 hashes.

| App | SHA-256 |
| --- | --- |
| `odk_remote_control.bin` | `20aefd4d25d344831bc93150976d88cef9839e98219993ab43281d3f9e5084cd` |
| `odk_p4_camera.bin` | `1418d16d166ed34d827d5ba35bb9f8bd6fb70cbbfa36a9f70fa98f2b6884f702` |

The S3 host gesture and state-frame executables also passed both CTest checks.
Their temporary source tree includes the existing cJSON host fixture from preserved research.
The first temporary host configuration omitted that dependency; copying it resolved configuration without source changes.

P4 configuration reports unknown `CAMERA_SC2336_AUTO_DETECT` and `TINYUSB` symbols in the existing defaults.
Managed TinyUSB reports unused audio buffers, and managed esp_video reports deprecated ISP constants.
These warnings remain unresolved; neither target build reports a native host compilation error.

These results establish target compilation and image generation, not physical startup or unchanged device behavior.
No firmware was flashed or used for live capture during the build verification above.

### Authorized physical firmware verification

The user later authorized S3 and P4 flashing and limited P4 acceptance to enumeration without image or audio capture.
A fresh source comparison found only the same two changed S3 test inputs; production build inputs and retained binaries still matched.
The CM5 serial identity resolved to `/dev/ttyACM0`; the ROM tool confirmed an ESP32-S3 before writing.
The existing Remote Bridge temporarily stopped to release that port and restarted after flashing.
The tool wrote the retained bootloader, partition table, and 274560-byte App image, and verified each written hash.
The S3 USB serial identity returned after reset, and the Remote Bridge returned to its active running state.
The operator confirmed that the S3 screen was normal.
Physical touch events, control mappings, and unchanged input behavior remain unverified.

Read-only CM5 checks on 2026-10-11 confirmed the existing P4 `303a:7002` USB device.
Its video interfaces remained available at `/dev/video0` and `/dev/video1`.
ALSA listed its microphone at card two, device zero.
Both attempts to identify the Mac serial target failed with no serial data; neither attempt wrote flash.
The user then deferred P4 flashing, so the candidate P4 firmware and its enumeration remain unverified.
No image or audio was captured.
The existing P4 enumeration does not establish acceptance of the candidate firmware.


## Futu negotiated runtime diagnosis verification

The default Python publisher now answers diagnosis requests through its existing readable publishing connections.
The Shell uses the owned Futu source and a separate Main diagnosis plugin.
The previous Futu service port remains unchanged.

The real Python subprocess checks cover requests during connection startup and after publication enters its waiting interval.
The complete local path includes Main composition, FutuSource, the publishing socket, Python Plugin Host, and the actual diagnosis CLI.
The selected publisher reports its current lifecycle state while holdings remain available.
Unrelated unavailable runtimes retain their diagnostic fields without changing the selected plugin's exit result.

A failing socketpair check reproduced a desk closing before its diagnosis response.
The corrected waiting loop isolates that connection and continues to receive requests from other desks.
Default waiting executes on the owner thread.
Custom publishers and injected waiting functions retain their previous contracts.

| Verification | Result |
| --- | --- |
| macOS Shell: `TMPDIR=/tmp corepack pnpm@11.22.0 test` | 979 passed, 2 skipped, 0 failed |
| macOS Futu: `uv run --with pytest python -m pytest tests/ -q` | 126 passed |
| Linux Node 24 affected tests with actual Python interoperability | 50 passed |
| Linux Python 3.13 Futu tests | 126 passed |

The full Shell run initially exposed a TCP authentication refusal that reset its test client.
The test now accepts that reset only for expected authentication refusal.
It still requires both token rejections and no delivered snapshots.
The final complete Shell run passed.

The [Futu guide](../../../integrations/futu-poller/README.md#negotiated-runtime-diagnosis) owns protocol bounds and remaining transport limits.
These checks do not prove Windows named-pipe diagnosis, real Futu SDK behavior, deployment, or device acceptance.

## Futu connection transport verification

The connection transport checks ran on 2026-10-08.
The macOS Python suite passed 143 tests.
The Linux Python suite passed the same 143 tests in a container without network access.
The complete macOS Shell suite passed 979 tests, skipped two tests, and reported no failures.
The Linux Shell diagnosis checks passed 21 tests, including actual Python publisher exchanges.
Independent review passed 54 related Python checks and nine Python-to-Main protocol checks without material findings.

The [transport checks](../../../integrations/futu-poller/tests/test_connection_plugin.py) replace connection creation while retaining the default publisher.
They verify parsed Unix, TCP, and named-pipe targets, authentication records, service identity, revision, publication, and resource ownership.
They reject asynchronous connection results and invalid readable adapters.
A failed descriptor does not stop an independent diagnosis connection.
Single endpoint selection retains the configured token file for TCP and named-pipe authentication.
Custom publishers retain their existing dependency behavior.
The [Futu guide](../../../integrations/futu-poller/README.md#local-component-plugins) owns the transport factory and connection contracts.

These checks use controlled adapters and temporary local sockets.
They do not establish Windows named-pipe reads, SDK acceptance, deployed host behavior, or physical device acceptance.

## WeRead replacement verification

The WeRead replacement checks ran on 2026-10-08.
The focused source-plugin, reading, development-loader, Widget, and replacement checks passed 47 tests on macOS and Linux.
Linux used Node.js 24 with read-only source mounts and no network access.
The complete macOS Shell suite passed 992 tests, skipped two tests, and reported no failures.

The [shared checks](../tests/weread-plugin-parity.test.js) select the default source or an independently linked replacement through the actual CLI.
The [replacement entry](../tests/fixtures/weread-replacement/entry.cjs) does not import the built-in WeRead source or call its factory.
It implements controlled notebook requests, highlight selection, synchronization, cache persistence, and cover resolution.
Both implementations use the same public reading projection.
The checks verify IPC records and actual Open DeskOS Data readings from the owned source.
They cover empty, error, unconfigured, and cached states, four-book cooldown, notebook limits, highlight limits, and resync timing.
They also cover cover retries, image types, byte limits, API errors, invalid cache schemas, and cache failures.
Cached health queries do not refresh the provider.
Disable removes the handler and reading.
Enable constructs a new source and restores cached readings.
Removing the development link restores the default factory and IPC on the next startup.

Independent review passed the same 47 focused checks without blocking findings.

All provider responses and cache files are controlled test inputs.
Cover-cache eviction remains outside these replacement checks.
These results do not establish real WeRead service compatibility, rendered replacement acceptance, signed distribution, deployed hosts, or physical device acceptance.

## WeRead request ownership verification

The WeRead request ownership checks ran on 2026-10-08.
Six failing regression checks reproduced missing cancellation during notebook, cover, and parallel bookmark requests.
The source now tracks refreshes, requests, JSON bodies, and cover bodies until they settle.
The plugin passes its lifetime signal and registers source cleanup before IPC setup.
Stop cancels requests and waits for owned work before another source starts.
A transport that ignores cancellation keeps cleanup pending until its work settles.
Late responses cannot publish state or write cache files.
Post-cancellation responses do not start new body processing.
A failed bookmark request does not release ownership of pending sibling requests.

The [shared checks](../tests/weread-plugin-parity.test.js) exercise these boundaries for the default source and independent replacement.
They also preserve separate concurrent IPC and Open DeskOS Data selections with reverse completion order.
The last completed request remains the source state, as before.
Stopped sources do not start another refresh.
The focused checks passed 59 tests on macOS and Linux.
The complete macOS Shell suite passed 1004 tests, skipped two tests, and reported no failures.
Linux ran with strict unhandled-rejection handling, read-only source mounts, and no network access.
Independent review passed 60 related tests with strict unhandled-rejection handling and found no material issues.

The checks use controlled pending requests and temporary cache files.
They do not establish real service behavior, rendered replacement acceptance, deployed hosts, or physical device acceptance.

## System channel stop retry verification

The system channel stop retry checks ran on 2026-10-08.
Four failing regression checks reproduced skipped client cleanup after synchronous exceptions and asynchronous rejections.
Both Personal Bot and Remote Link now mark client stop complete only after the operation succeeds.
Failed stop retains the instance and registered cleanup responsibility.
The host retries client stop before it creates a replacement.
Independent channel plugins remain running.
Registered cleanup does not repeat successful client stop.

The [channel checks](../tests/system-channel-plugins.test.js) also preserve Remote events, App endpoints, Bot acknowledgement guards, proposal validation, and frame status.
The focused checks passed 43 tests on macOS and Linux with strict unhandled-rejection handling.
Linux used read-only source mounts and no network access.
The complete macOS Shell suite passed 1008 tests, skipped two tests, and reported no failures.
Independent review passed 36 lifecycle and shutdown checks without findings.

These checks use controlled clients and temporary local channels.
They do not establish real agent behavior, physical Remote input, deployed hosts, or hardware acceptance.

## Hydra MQTT resource ownership verification

The Hydra resource ownership checks ran on 2026-10-08.
Two failing regression checks reproduced premature shutdown completion and missing MQTT completion handling.
Three additional failing checks reproduced unsafe cleanup certification after a failed shutdown.
The source now waits for the MQTT completion callback and shares its shutdown operation.
Stopped sources ignore late MQTT events and cannot reopen connections from snapshots.
Successful release permits the plugin host to create a new source and client.
Failed release removes IPC but retains source ownership and prevents replacement.

The installed MQTT implementation can acknowledge repeated shutdown without repeating failed cleanup.
The source therefore retains the rejected shutdown operation until process shutdown.
It does not treat another acknowledgement as evidence of resource release.
The [dependency and lifecycle checks](../tests/hydra-dependency-resolution.test.js) exercise the actual installed MQTT shutdown method without a broker.
They also verify plugin-host replacement ordering with controlled clients.
Existing parsing, retained readings, diagnostics, subscription topics, canonical dependency loading, and retry intervals remain covered.

The focused checks passed 55 tests on macOS and Linux with strict unhandled-rejection handling.
The complete macOS Shell suite passed 1014 tests, skipped two tests, and reported no failures.
Linux used read-only source mounts and no network access.
Independent review passed 62 related checks without remaining findings.

These checks do not establish broker behavior, deployed hosts, physical Hydra acceptance, or independent source replacement compatibility.
The controlled Hydra replacement checks are recorded below.

## Hydra replacement verification

The Hydra replacement checks ran on 2026-10-08.
The [shared checks](../tests/hydra-plugin-parity.test.js) load replacements through the actual development CLI and saved configuration.
The [replacement entry](../tests/fixtures/hydra-replacement/entry.cjs) owns connection creation, retry timing, event handling, and shutdown independently.
It does not call the built-in source factory.
The earlier fixture shared the existing protocol parser and public reading projection.
The later signed Hydra section records independent protocol and projection acceptance.

Both implementations retain subscription scope, connection settings, retained readings, live readings, timestamps, stale boundaries, diagnostics, and availability states.
IPC and Open DeskOS Data read the same owned source.
Disable waits for MQTT release before another source starts.
Uncertain release retains ownership and blocks another connection.
Removing the development link restores the default factory using the same saved configuration.
The default source retains canonical dependency loading and accepts injected connections and a clock for controlled acceptance.

Two failing regression checks reproduced connection creation during health queries after the retry interval expired.
Health now reads cached state without starting a connection.
Normal consumers retain the existing retry policy.
Legacy source adapters retain their existing snapshot fallback.

The focused checks passed 61 tests on macOS and Linux with strict unhandled-rejection handling.
The complete macOS Shell suite passed 1021 tests, skipped two tests, and reported no failures.
Linux used read-only source mounts and no network access.
Independent review passed 36 related checks without findings after the cached-health correction.

Replacement connection providers are controlled test inputs.
These results do not establish live broker behavior, packaged replacement distribution, rendered acceptance, deployed hosts, or physical Hydra acceptance.

## Python development replacement verification

The Python development checks ran on 2026-10-08.
The actual startup command selects replacement directories with explicit native trust and grants for each declared capability.
The loader captures bounded entry bytes without executing them during inspection.
Disabled components and an unauthenticated gateway do not execute their entries.
Replacement declarations preserve component identity, host, kind, and provided ports.
The host checks the selected dependency graph before any factory executes.
Publisher, gateway, loop, and transport fixtures supply their actual runtime ports through external Python entries.
The command fixture starts a replacement loop through the actual operational entry point.
The existing default three-file deployment remains covered.

A failing regression reproduced a concurrent parent-directory change that captured entry bytes outside the selected package.
POSIX now opens canonical ancestors through directory descriptors and rejects symbolic links during traversal.
Windows checks the final path of the opened file handle before reading bytes.
Simulated handle checks cover local paths, UNC paths, rejection, and failed-handle release.
Windows execution remains unverified; SMB normalization can reject valid selections.
Independent review found no remaining material issue after the containment correction.

The complete Python command passed 174 tests on macOS and Linux with runtime warnings treated as errors.
The Linux Python-to-Main diagnosis checks passed 21 tests with strict unhandled-rejection handling.
Linux used read-only source mounts and no external network access.
The complete macOS Shell suite passed 1021 tests, skipped two tests, and reported no failures before the containment-only correction.
The final focused development command passed 31 tests.
The independent review passed 27 focused checks before the four component-port fixtures were added.

These checks use synthetic components, credentials, and temporary local channels.
They do not establish real SDK behavior, signed distribution, updates, rollback, deployed hosts, or hardware acceptance.
Native trust does not provide a sandbox.

### Extended Windows path and operational failure checks

Two failing simulated checks reproduced rejection of equivalent extended drive and UNC path names.
The loader now normalizes the selected name and the opened-handle name before comparison.
Different final paths still fail before entry bytes are read and release the opened descriptor.
Actual CLI fixtures reject entry syntax errors, missing factories, initialization failures, and loop failures.
Factory and loop failures release registered resources.
Independent review passed 37 focused checks and found no material issue.
The complete Python commands passed 180 tests on macOS and Linux with runtime warnings treated as errors.
The Linux Python-to-Main diagnosis command passed 21 tests with strict unhandled-rejection handling.
Linux tests used read-only source mounts and no external network access.
Native Windows execution remains unverified.

## Resident external startup replacement verification

The resident development checks ran on 2026-10-08.
The startup entry accepts explicit selections and requires native trust before reading the selection file.
Each selected declaration preserves its existing identity, host, kind, ports, dependencies, and empty permissions list.
Unknown identities, duplicate selections, incompatible declarations, and inactive optional components are rejected before factory execution.
The [resident contract](../../../integrations/personal-bot/docs/CONTRACT.md#trusted-resident-development-selections) owns selection format and trust limits.

External CommonJS factories supply actual service, channel, runtime, home, and watch ports in controlled compositions.
The actual resident inspection command reports declarations without executing entries or preparing operational directories.
The actual startup command loads external runtime and home entries and closes their resources on termination.
Observers receive the selected resources and release their attachment cleanup.
A failed external home factory releases its registered allocations while the resident channel and runtime remain available.
Default startup, shutdown order, pending initialization cancellation, and cleanup retry remain covered.

The [voice consumer check](../../../integrations/personal-bot/tests/development-plugins.test.mjs) also ran on 2026-10-10 with the actual resident service.
It compares the default Pi session adapter with an independent Agent loaded through the existing trusted CommonJS selection.
Synthetic recording and transcription inputs exercise successful requests, private provider failures, runtime disable, enable, and subsequent requests.
Both selections preserve response text, transcript, lifecycle states, public errors, recording cleanup, and retained service and channel identities.
A construction guard prevents the selected runtime from creating the default adapter.
The affected command passed 79 tests with zero failures or skips in 2843 milliseconds.
The initial expectation omitted the established idle frame after resume; the corrected expectation retains that frame.
No production source changed.

Run this command from `integrations/personal-bot/`:

```sh
node --test tests/development-plugins.test.mjs tests/plugin-composition.test.mjs tests/service.test.mjs tests/agent.test.mjs
```

The complete macOS Personal Bot command passed 545 tests, skipped two tests, and reported no failures.
The complete macOS Shell command passed 1021 tests, skipped two tests, and reported no failures.
Personal Bot type checking passed.
The focused development and composition checks passed 27 tests on macOS and Linux with strict unhandled-rejection handling.
Linux used read-only source mounts and no external network access.
Independent review passed 27 focused checks and found no material issue.

The operational fixture uses temporary directories, a local resident socket, and synthetic Agent and home resources.
It performs no recording, transcription, model request, or production activation.
These checks do not establish alternative real Agent behavior, Windows resident acceptance, CM5 deployment, signed distribution, or revision rollback.
The loader retains normal CommonJS caching and trusted mutable native code at startup.

## Hosted Pi external startup replacement verification

The Hosted Pi development checks ran on 2026-10-08.
The shared native loader accepts separate Hosted Pi selections with at most three components.
Explicit native trust precedes selection reads; identities, host, kind, ports, dependencies, and empty permissions remain validated.
The [task contract](../../../integrations/personal-bot/docs/CONTRACT.md#trusted-hosted-pi-development-selections) owns selection format, bindings, and trust limits.
The inspection command loads no task configuration and executes no external entry or provider.

External listener factories receive frozen request and disconnect callbacks from the host.
The host retains startup task responses and runtime diagnosis validation.
External endpoint factories receive the configured descriptor path and existing publication operations.
The exported endpoint port retains its original `file` and `published` fields.
Five failing regressions reproduced acceptance of selected components with missing runtime methods.
Selected listener, service, and published endpoint components now fail startup when required operations are missing.
Factory-registered allocations are released after rejection.
Default and previously injected factories retain their existing compatibility.

The actual daemon fixture starts all three external entries through its operational command.
It serves a task list request and reports all selected versions through runtime diagnosis.
It publishes the existing endpoint descriptor and removes that descriptor during successful shutdown.
Selected listener cleanup runs once; service and endpoint cleanup each run once per selected instance.
Default publication failure, pending initialization cancellation, and cleanup retry remain covered.

The extended daemon fixture uses the selected external service factory with the existing task engine and a controlled execution adapter.
Actual socket requests start a pending task; its adapter verifies the saved running receipt before execution.
The actual Plugin CLI disables that service and waits for cancellation.
Before enable, the fixture checks the cancelled receipt, unchanged verification state, and observed adapter abort.
After enable, repeating the same start payload returns the saved cancellation without another execution or record rewrite.
The earlier empty-list service failed the new task identity assertion.
The reviewed fixture passed locally and on CM5; the CM5 command passed one check without skips in 2449 milliseconds.
All 187 captured device inputs remained unchanged.
Before the outcome extension, a source comparison on 2026-10-11 matched all 187 inputs against the checkout.
That comparison also matched all 322 captured inputs from the preceding reviewed local Bot command.
That command passed 602 checks, skipped three platform cases, and passed type checking.
These comparisons reuse the recorded results without starting another daemon or making a new device acceptance claim.

The outcome extension completed on 2026-10-11 through the same selected daemon and actual socket.
The controlled adapter now completes one task and fails another after verifying each persisted running receipt.
Public status and saved records retain the task identity, response, terminal state, and `not_run` verification.
Repeating either start request preserves exact record bytes and does not execute the adapter again.
Final process closure precedes another execution-count check and exact terminal-record comparison.
The new completion assertion first failed against the pending-only adapter and passed after the fixture supplied both controlled outcomes.
No production source changed.

The first expanded CM5 command passed 116 checks and failed one because its wrapper used the repository root as its working directory.
The helper test requires the Personal Bot directory for its existing relative CLI path.
The first local complete command also inherited a runtime directory, contradicting the existing absent-session fixture expectation.
The final wrappers use the package directory and omit the inherited runtime directory.
The complete local command retains the package script's default file scheduling; explicit runtime concurrency cases remain unchanged.

The final CM5 command passed all 117 affected checks without failures or skips in 12455 milliseconds.
The final local complete Bot command passed 602 checks, skipped three platform cases, and reported no failures in 25057 milliseconds.
Both final commands retained all 322 captured inputs unchanged.
No task-owned acceptance process remained on CM5 after completion.
Fresh review found no actionable issue in the outcome, persistence, replay, and shutdown assertions.
These results use controlled execution and the shared task engine; they do not establish live SDK or Windows daemon behavior.

The first CM5 candidate lacked SDK dependencies and failed before startup; that attempt established no execution acceptance.
The successful candidate copied Linux dependencies after package and lockfile equality checks; all dependency links remained inside the candidate.
Independent review found an assertion-order gap; cancellation checks now precede enable, and the reviewer confirmed resolution.
This checks selected composition and existing engine behavior, not an independent task algorithm or live SDK execution.
The Unix socket fixture does not establish a Windows task daemon.
No production source changed.

The [shared connection cleanup checks](../../../integrations/personal-bot/tests/task-composition.test.mjs) also ran with default and selected service factories on 2026-10-10.
They use the actual task protocol listener and local socket requests.
Failed asynchronous disconnect retains the service during partial disable and full shutdown.
Successful retry releases the connection before closing the service once.
Selected version checks and a default construction guard establish which service owns the operations.
The affected command passed 29 tests with zero failures or skips in 2717 milliseconds.
These checks establish selected service ownership; they do not establish complete task execution replacement parity.
No production source changed.

The [independent terminal record reader](../../../integrations/personal-bot/tests/task-development-plugins.test.mjs) passed locally, on CM5, and on Windows on 2026-10-10.
Its external service owns read-only dispatch and uses the existing record loader and goal projection helper.
A construction guard prevents the selected path from creating the default task engine.
Default and selected services return matching lists and statuses for existing finished, failed, cancelled, and interrupted records.
The interrupted record includes a multibyte UTF-8 response at the existing 16384-byte limit.
Lists exclude private task details; statuses retain saved identities and outcomes without replay.
Disable and enable preserve the listener and create a fresh service with the same record results.
Endpoint publication follows service availability; saved record bytes remain unchanged through shutdown.
The initial placeholder failed the comparison before the independent implementation passed.
Both device commands passed one check without skips across 176 unchanged captured inputs.
The complete local Bot command passed 602 checks, skipped three, and preserved 322 captured inputs; type checking passed.
A fresh independent review found no actionable issues.
These checks use controlled listeners and publication callbacks; task execution and live SDK session control remain separate.
No production source changed for this comparison.

Run this command from `integrations/personal-bot/`:

```sh
node --unhandled-rejections=strict --test --test-concurrency=1 tests/task-composition.test.mjs tests/task-development-plugins.test.mjs tests/task-runtime-control.test.mjs tests/task-runner.test.mjs tests/task-client.test.mjs
```

The complete macOS Personal Bot command passed 556 tests, skipped two tests, and reported no failures.
The complete macOS Shell command passed 1021 tests, skipped two tests, and reported no failures.
Personal Bot type checking passed.
The focused commands passed 47 tests on macOS and Linux with strict unhandled-rejection handling.
Linux used read-only source mounts and no external network access.
Independent final review passed 44 related checks and found no material issue.

The operational fixture uses temporary state, a local socket, and a synthetic task service without model work.
Its external listener shares the existing task protocol library.
These checks do not establish alternative task execution, native Windows acceptance, CM5 deployment, signed distribution, or revision rollback.
The shared loader retains trusted mutable entries and normal CommonJS caching at startup.

## Remote Bridge multiple transport input parity

The Bridge input parity checks ran on 2026-10-08.
A failing local-socket regression reproduced dropped version 1 Remote input through the multiple transport Host.
The Host previously accepted only navigation records.
It now uses the same existing navigation and Remote input validators as the single bridge.
Accepted input and action records remain unchanged.

The regression covers all nine current input names, existing action record forms, invalid records, and input from disabled transports.
Input rejection retains independent transport delivery and the existing listener.
The complete Bridge commands passed 49 tests on macOS and Linux with strict unhandled-rejection handling.
The complete macOS Shell command passed 1021 tests, skipped two tests, and reported no failures.
Linux used read-only source mounts and no external network access.
Independent review passed 49 Bridge checks and found no blocking issue.

The checks use injected transports and temporary local sockets without physical input or live microphone work.
External transport entry loading, production distribution, physical Remote behavior, and supported-device acceptance remain unverified.

## Native Shell input and App navigation acceptance

The existing Bridge client, gamepad, and App Manager browser checks ran on CM5 and macOS with private host paths.
Both commands passed all seventeen checks without failures or skips.
The test durations were 15409 milliseconds on CM5 and 8587 milliseconds on macOS.
All 694 captured Bridge and Shell source, test, script, and package inputs remained unchanged.
No task-owned acceptance process remained on CM5 after completion.

The actual Bridge and Shell client exchange authoritative state, factual link state, and navigation through a temporary Unix socket.
Controlled client cases preserve reconnect, state resend, contextual actions, validation, and resident-agent MIC callback routing without audio recording.
Injected gamepad readings preserve shared intents, shoulder paging, repeat cadence, duplicate suppression, and unreadable-pad isolation.
These gamepad checks use a controlled browser model rather than a physical controller.

The App Manager browser fixture compares default, signed, and development-selected implementations through actual preload and Renderer consumers.
Synthesized browser pointer Back and keyboard Escape restore the original focus target.
Mount failure restores the previous running App; deliberately omitted rollback fails the same consumer assertion.
Shutdown removes handlers before destroying the window.
The fixture controls unrelated readings and does not start complete production Main.

Run this command from the repository root with private host paths:

```sh
node --unhandled-rejections=strict --test --test-concurrency=1 runtime/shell/tests/remote-bridge-client.test.js runtime/shell/tests/gamepad-input.test.js runtime/shell/tests/app-manager-electron.test.js
```

These results do not establish physical touch, keyboard, gamepad, Remote input, or complete live Shell integration.
A fresh Tailscale status check on 2026-10-11 still reported the Windows handheld offline.
No product source, fixture deadline, production service, or active release changed.

## Native Remote Bridge transport acceptance

The complete existing Bridge command ran on CM5 with private configuration, state, workspace, runtime endpoints, and temporary paths.
All 65 checks passed without failures or skips in 5281 milliseconds.
The captured Bridge sources and tests, shared Shell sources and scripts, and package inputs totaled 194 files.
All captured inputs remained unchanged on CM5 and in the current checkout.
No task-owned acceptance process remained on CM5 after completion.

The first macOS command passed 63 checks and failed both runtime control cases with `runtime-unavailable` under its longer temporary path.
A complete rerun with a short private temporary root passed all 65 checks in 1762 milliseconds.
Both macOS commands retained the same 194 inputs unchanged.
The short-path rerun does not identify the precise cause of the earlier failure.

Existing mock transports and loaded external factories preserve all nine input names, USB priority, retained-state fallback, and listener availability.
Retired callbacks cannot forward input; enable creates the required fresh selected instance and message subscription.
Operational entry checks select both transports, expose their versions through diagnosis, and stop wireless before USB on termination.
Runtime control preserves independent resources while exercising disable, enable, protected identities, and lifecycle failure recovery.
CDC tests use injected discovery and descriptor operations for cancellation, delayed opening, failed close, active writes, and cleanup retry.
Framing checks retain UTF-8 boundaries and reject oversized input before decoder allocation.

Run this command from the repository root with private host paths:

```sh
node --unhandled-rejections=strict --test --test-concurrency=1 integrations/remote-bridge/test/*.test.js
```

These checks do not open physical devices, deliver physical input, or record microphone audio.
They do not establish actual USB enumeration, wireless drivers, physical handover, complete Shell input integration, or Windows acceptance.
No product source, fixture deadline, production service, or active release changed.

## Remote Bridge external startup verification

The Bridge development checks ran on 2026-10-08.
The [operational entry](../../../integrations/remote-bridge/lib/main.js) accepts explicit trusted transport selections and offline inspection.
Without a selection, startup retains the built-in USB Adapter.
Selected factories supply the actual single adapter or multiple transport collection.
Declarations preserve listener dependencies, transport ports, empty permissions, and the existing USB priority policy.

The [shared transport scenarios](../../../integrations/remote-bridge/test/transport-replacement-parity.test.js) compare existing mock transports with independently loaded external EventEmitter transports.
Both preserve all nine Remote input names, USB priority, retained-state wireless fallback, and listener availability after transport disable.
Retired callbacks cannot forward input; re-enabling a selected transport creates a fresh instance with one message subscription.
Single and multiple bridge cancellation wait for pending factory allocations and cleanup before restart.
Canceled instances never start and retain no message subscriptions.
The actual CLI fixture starts both external transports, reports their selected versions, and sends the wired state through USB.
Termination stops and destroys wireless before USB and closes the listener afterward.

The operational fixture reports the selected version through the existing diagnosis socket.
It receives Shell state with `link: "wired"` and forwards an unchanged Back input record.
Termination stops and destroys the selected transport once and removes the temporary socket.
Inspection executes no entry or device discovery.
Cleanup failure retains ownership; successful retry permits a fresh instance.
A failing regression reproduced false startup success after malformed transport validation and failed cleanup.
Single transport startup now reports that failure.
Independent review found empty CLI values that could start the default transport.
Failing regressions reproduced the issue; empty inspection and selection values now fail before operational startup.

The complete Bridge commands passed 62 tests on macOS and Linux with strict unhandled-rejection handling.
The complete macOS Bridge command ran again on 2026-10-10 and passed 65 tests without failures or skips in 3933 milliseconds.
This rerun includes the existing external transport parity, operational entry, cancellation, runtime control, protocol, and USB descriptor checks.
No Bridge source or test changed for this rerun.

Run this command from `integrations/remote-bridge/`:

```sh
node --unhandled-rejections=strict --test --test-concurrency=1 test/*.test.js
```

The complete macOS Shell command passed 1021 tests, skipped two tests, and reported no failures.
Linux used read-only source mounts and no external network access.
Independent entry review passed 57 Bridge checks and found no outstanding actionable issue.
Independent parity review passed 62 Bridge checks and confirmed the stated local fixture coverage without actionable findings.

The fixtures use temporary directories, local sockets, and synthetic transports without hardware discovery or live capture.
Native entries remain trusted mutable code with normal CommonJS caching.
These checks establish local selected transport routing, input, arbitration, fallback, and resource ownership with synthetic device I/O.
They do not establish physical USB or wireless driver parity, physical handover, signed distribution, immutable revisions, rollback, or supported-device acceptance.

## Appearance startup management verification

The appearance management checks ran on 2026-10-08.
A failing browser-script regression reproduced ignored startup disables for appearance plugins.
The appearance Host now reads the same disabled identity snapshot as renderer surfaces before body content.
Disabled Pixel falls back to Instrument while the saved explicit Pixel preference remains unchanged.
Re-enabling Pixel and restarting restores the saved appearance.
Unknown saved themes retain the existing Instrument fallback.
Unrelated disabled feature identities leave theme selection unchanged.

The isolated Electron fixture uses the actual CLI to disable and enable Pixel with temporary configuration.
After each reload, it checks theme selection and the actual appearance lifecycle catalog.
The complete macOS Shell command passed 1022 tests, skipped two tests, and reported no failures.
The focused Node command passed 27 tests with strict unhandled-rejection handling.
Independent review passed 46 related Node checks and found no actionable regression.
The isolated Electron interaction command passed input, motion, geometry, style, sequential-state, six density, and seven theme subchecks.
Each subprocess used temporary user data or its own existing temporary fixture profile.
Some existing fixtures omit provider IPC handlers; their fallback diagnostics remain present without failing these checks.

These checks establish synchronous selection and isolated Electron behavior, not first-frame pixel or physical-device acceptance.
External appearance loading, rendered replacement parity, native Windows acceptance, and CM5 acceptance remain unverified.

## External appearance declaration verification

The appearance declaration checks ran on 2026-10-08.
The [development CLI](CONFIGURATION.md#appearance-declarations) links pure declarations for existing theme identities with explicit trust and replacement selection.
Selections preserve packaged assets, fonts, geometry, and derived Cell tokens while overriding bounded hexadecimal palette values.
Main uses one validated selection for its launch query and installed package context.
The renderer checks that selection before body content and uses a constructed stylesheet under the unchanged Content Security Policy.

Failing regressions reproduced changed Pixel package fonts and geometry after incomplete token merging.
Another failing regression reproduced acceptance of image functions in palette values.
The final implementation preserves all packaged tokens and accepts only hexadecimal palette colors.
Updated Main VM fixtures supply the added appearance dependency; all change-caused fixture failures are resolved.

The actual Electron fixture links Pixel through the CLI and reads the selected version through runtime diagnosis.
Shell and an opaque installed package frame both expose the selected primary color.
The package retains Zpix and its zero card radius.
CLI removal preserves the source directory and restores default version 1.0.0 and the default primary color after reload.
Invalid, duplicate, and oversized renderer selections restore packaged appearances.

The complete macOS Shell command passed 1028 tests, skipped two tests, and reported no failures.
Independent final review passed 107 related checks and found no outstanding actionable issue.
The final CLI checks passed 19 tests after updating its description of appearance links.
The isolated Electron interaction command passed input, motion, geometry, style, sequential-state, six density, and seven theme subchecks.
Each subprocess used temporary user data or its own temporary fixture profile.
Existing fixture fallback diagnostics for omitted provider IPC handlers remain present without failing these checks.
All checks use temporary configuration and fixture data without live services, capture, or production activation.
These results do not establish first-frame pixels, arbitrary appearance code replacement, production revisions, native Windows acceptance, or CM5 acceptance.

## Quota replacement and request ownership verification

The Quota checks ran on 2026-10-08.
The focused source, provider, source-plugin, and replacement checks passed 28 tests on macOS and Linux.
Linux used Node 24 with a read-only checkout and no external network.
The HTTP fixtures use loopback servers and synthetic credentials.

The [shared scenarios](../tests/quota-plugin-parity.test.js) select default or external composition through the actual development CLI and saved configuration.
The [external entry](../tests/fixtures/quota-replacement/entry.cjs) owns its composition without calling the built-in plugin factory.
The later independent implementation follows the [Quota contract](QUOTA_PLUGIN_CONTRACT.md).
The checks preserve IPC account details, reset credits, errors, and availability states.
Open DeskOS Data retains reading identity, account identity, percentages, reset times, and its existing restricted projection.
Disable removes IPC and readings; enable creates one new instance after cleanup.
Cleanup failure retains ownership and prevents another instance until retry succeeds.
Removing the development link preserves package files and restores the default on the next composition.

The [native request checks](../tests/quota-source.test.js) cancel requests before headers, during response collection, and across concurrent accounts.
They also cancel optional requests and fallback attempts.
Stop waits for cancelled native requests to close.
Pending reads cannot publish late available results or start new reads after cancellation.
Normal HTTP checks retain provider fallback, optional metadata failure, disabled-account exclusion, and account error isolation.

The complete Shell test command passed 1041 tests and skipped two tests.
Independent source review passed 33 related tests and five syntax checks without material findings.

These results do not establish another provider, rendered replacement acceptance, signed distribution, deployed hosts, or physical device acceptance.

## Shared JavaScript startup preference verification

The shared preference checks ran on 2026-10-08.
The [configuration contract](CONFIGURATION.md#saved-plugin-preferences) owns the common file, environment exclusions, startup timing, and runtime limits.
Personal Bot, Hosted Pi, and Remote Bridge use the same Shell configuration module in source and flattened release layouts.
The existing CLI saves preferences without executing runtime code or changing running services.

The [shared checks](../tests/plugin-runtime-preferences.test.js) passed eight scenarios through actual CLI preference writes and runtime inspection entries.
They also start controlled compositions to verify disabled factories, dependent blocking, preserved listeners, and restoration at the next startup.
Selected native entries remain unexecuted while disabled.
The focused preference and configuration commands passed 18 tests on macOS and Linux.
Linux used Node 24 with a read-only checkout and no external network.
The complete Personal Bot command passed 556 tests and skipped two tests.
Its typecheck passed.
Remote Bridge passed 62 tests from the repository root.
The affected Personal Bot development fixtures passed 32 strict tests after configuration isolation changes.

Independent review identified CLI fixtures that inherited the operator configuration.
The fixtures now use temporary configuration directories and exclude inherited disable settings.
The review then passed 53 strict tests with a deliberately disabled parent configuration.
Five inspection tests also passed with malformed parent configuration.
No material review finding remains.

One concurrent Shell run failed an existing startup-wait assertion; another failed the real Electron installation fixture.
Both isolated checks passed without changing their assertions or verification deadlines.
The final complete Shell command passed 1049 tests and skipped two tests.

These results do not establish Python or firmware preference management, live cross-runtime operations, deployed hosts, or physical device acceptance.

## Shared Python startup preference verification

The shared Python preference checks ran on 2026-10-08.
The canonical poller startup and declaration inspection commands now read the common Plugin CLI preferences.
They add shared disables to existing standalone preferences, environment exclusions, and explicit invocation disables.
The [configuration contract](CONFIGURATION.md#saved-plugin-preferences) owns the shared path and startup timing.
The [Python guide](../../../integrations/futu-poller/README.md#saved-component-preferences) owns the projection and standalone compatibility limits.

The [shared tests](../../../integrations/futu-poller/tests/test_shared_preferences.py) write preferences through the actual Node CLI and inspect Python declarations.
They start controlled operational compositions without connecting to the SDK or a gateway.
They also launch the actual Python entry with a disabled trusted external module that fails if imported.
The disabled entry remains unexecuted and shutdown succeeds.
Inspection excludes provider settings and private diagnostic content.
Malformed shared files preserve environment and explicit exclusions without changing persisted bytes.
Standalone invalid-file rejection remains unchanged.
Shared path precedence, UTF-8 replacement, numeric JSON version values, and last-key selection follow the Shell enable projection.
Nonstandard JSON constants receive the generic diagnostic.
Excessive JSON nesting also receives this diagnostic; these checks do not establish support for arbitrary nesting depth.
Python does not interpret or validate native development link metadata from this file.

Independent review found a deep JSON parsing error that bypassed recovery.
A failing regression preceded the exception-handling fix.
The regression now retains exclusions and emits the generic diagnostic.
The complete Python suite passed 202 tests on macOS and 202 tests on Linux.
Linux used a read-only checkout without external network access.
The affected Shell commands passed 26 tests.
Independent review passed 74 relevant tests after the parser compatibility fixes.
No material review finding remains.

These results do not establish firmware preference management, live cross-runtime operations, deployed hosts, alternative SDK behavior, or physical device acceptance.

## Plugin CLI package rollback verification

The rollback checks ran on 2026-10-08.
The [Plugin CLI](../scripts/odk-plugin-cli.js) now exposes the existing application store rollback operation.
The [configuration contract](CONFIGURATION.md#plugin-package-management) owns command scope and recovery semantics.
The command restores verified installed snapshots without the workspace draft.
It preserves the current revision when history, package verification, or identifier validation fails.
It retains the replaced revision for another rollback.

Two failing CLI scenarios preceded implementation.
The affected CLI, application control, and storage checks then passed 29 tests on macOS.
These checks include rollback through the real Electron package verifier.
Placement and runtime lifecycle checks passed another 13 tests from the Shell directory.
Independent review passed 33 relevant tests and the CLI syntax check without material findings.
Linux passed three CLI rollback and token scenarios with a read-only checkout and no external network.
Linux also passed 27 application control, storage, placement, and runtime lifecycle tests.
The token scenarios use Unix fixtures; they do not establish native Windows named-pipe acceptance.

Initial lifecycle commands used the repository root and failed to locate their Shell-relative source file.
The commands passed after using the required Shell directory without changing test assertions.
These checks do not establish signed native rollback, deployed hosts, or physical device acceptance.

## Development discovery fault isolation verification

The discovery checks ran on 2026-10-08.
Shell startup now reports damaged development links separately for Main, renderer, and appearance discovery.
It retains independent valid selections and restores packaged appearances for rejected appearance links.
The [configuration contract](CONFIGURATION.md#development-links) owns these startup and strict API semantics.

A failing regression preceded the per-link recovery implementation.
The [Main checks](../tests/development-plugins.test.js) retain valid factories beside missing directories and ungranted declarations.
Failed discovery does not reserve reading namespaces.
Disabled links remain unread, and discovery does not execute entry code.
Strict calls still reject invalid selections and overlapping namespaces.
A throwing diagnostic callback cannot block independent discovery.
The renderer and appearance checks retain valid selections without changing configuration bytes.
The [wired Main check](../tests/odk-data-wiring.test.js) uses actual CLI links and selects Weather beside a removed independent directory.
Changed dependency declarations still trigger composition validation before entry execution.

The focused commands passed 73 tests on macOS and 73 tests on Linux.
Linux used Node 24 with a read-only checkout and no external network.
JavaScript syntax checks passed for both changed source files.
The complete Shell command passed 1055 tests and skipped two tests.
Independent review passed 62 relevant tests without actionable findings.

These checks do not establish per-entry browser execution recovery, signed distribution, deployed hosts, or physical device acceptance.
Global dependency and port conflicts still require whole-composition validation.

### Renderer discovery resource ownership repair

The resource checks ran on 2026-10-10.
The [discovery scenarios](../tests/features/plugin-host.feature) cover failed registration, failed protocol removal, and cleanup retry.
A failing regression showed that protocol registration failure retained an acquired Native asset lease.
The [discovery plugin](../src/plugins/renderer-development.js) now registers cleanup before protocol registration.
Registration failure closes the lease without removing another owner's handler.
Later IPC registration failure removes the owned protocol handler before closing its lease.
Failed protocol removal retains the lease; the aborted handler refuses requests with status 410.
Cleanup retry removes the handler before closing the lease.
This repair uses the existing Host cleanup mechanism and adds no replacement interface.

The affected discovery, Native Renderer, Host, and development selection command passed 74 checks.
The broader Main, diagnosis, management, activation, and stylesheet recovery command passed 52 checks.
The isolated signed Native Renderer Electron fixture reported 31 Renderer plugins and successful replacement and linking.
An independent review reported no findings and separately passed all 22 discovery checks.
The [current full Shell result](#scope-and-status) includes this repair.
These results do not establish published asset retirement or supported-device acceptance.

### Renderer discovery startup selection

The [shared discovery checks](../tests/renderer-development.test.js) now select default and independent implementations through the existing Main composition.
The [alternative fixture](../tests/fixtures/renderer-development-replacement.js) owns entry requests, frame authorization, protocol registration, and cleanup.
It imports the public channel identifier without calling the default factory.
Four selected checks failed before the alternative fixture was implemented; these were verification fixture failures, not production defects.
Both implementations pass registration failure, cleanup retry, entry bounds, frame authority, and disable and enable checks.
Retained handlers refuse requests after disable; enabling creates fresh handlers.
The affected command passed 89 tests with no failures or skips.
Paired isolated Electron runs passed with signed Native Renderer entries, linked entries, and 31 Renderer plugins.
The selected run guards default factory execution and checks the selected version and running state.
Both runs returned equal fixture result objects.
The Electron command is `env -u ELECTRON_RUN_AS_NODE TMPDIR=/tmp node_modules/.bin/electron tests/renderer-diagnosis-electron.cjs --signed-native-renderer` from `runtime/shell/`.
Add `--selected-discovery` to select the alternative.
The [joint Main check](#external-runtime-diagnosis-replacement) subsequently loaded this alternative through trusted development CLI links.
Shared Native asset checks now run both discovery implementations through snapshot and live lease ownership.
Both preserve publisher-owned captures after discovery stops and remove their own IPC handlers and protocol routes.
Publisher closure refuses further captured-byte requests; released protocol handlers also refuse requests.
The shared asset, activation, and discovery command passed 49 tests without failures or skips in 3356 milliseconds.
The command was `node --test --test-concurrency=1 tests/native-renderer-plugins.test.js tests/native-renderer-activation.test.js tests/renderer-development.test.js` from `runtime/shell/`.
The [shared resource contract](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-signed-renderer-activation) retains bounded published captures and leaves automatic retirement unimplemented.
Supported-device acceptance remains unverified for this alternative.

## Replacement extension dependency verification

The dependency checks ran on 2026-10-08.
Main now validates replacements with their selected extensions before checking a reduced fallback graph.
The Plugin CLI includes existing Main selections when it checks a replacement link.
It excludes the previous link for the identity under replacement.
The [configuration contract](CONFIGURATION.md#development-links) owns provider ordering and unchanged public-port requirements.

Two failing regressions preceded the graph and CLI changes.
The [composition check](../tests/main-plugin-replacement.test.js) accepts an extension dependency while retaining the replacement public ports.
Missing dependencies, cycles, and duplicate extensions still fail without executing factories.
Rejected extensions cannot leave an invalid fallback graph.
The [CLI check](../tests/development-plugins.test.js) links independent provider and Weather entries without executing them.
The real Host then supplies matching Weather values through IPC and Open DeskOS Data.
Failed relinking preserves configuration bytes, and shutdown removes the owned IPC handler.
The [Main wiring check](../tests/odk-data-wiring.test.js) starts the linked provider and replacement beside an unavailable independent link.
Changed dependencies restore defaults before replacement execution.

The focused commands passed 82 tests on macOS and 82 tests on Linux.
Linux used Node 24 with a read-only checkout and no external network.
The complete Shell command passed 1057 tests and skipped two tests.
Independent review passed 58 relevant tests without actionable findings.

These results do not establish alternative provider behavior, signed distribution, deployed hosts, or physical device acceptance.

## Pi source request ownership verification

The Pi source checks ran on 2026-10-08.
Pi Sessions and Session Events now retain pending read ownership through their callable source ports.
The [architecture contract](ARCHITECTURE.md#current-shell-plugin-composition) owns cancellation and underlying transport limits.
The [source lifecycle checks](../tests/pi-source-lifecycle.test.js) cover pending parallel reads, local fallback, SSH callbacks, and replacement ordering.
Stop waits for all owned requests, including a sibling request after another request fails.
No new read or fallback scan starts after cancellation.
Results pending at cancellation report unavailable.
Already completed Promises retain their existing values.

Four failing regressions preceded implementation.
An affected contract test found delayed SSH invocation in the first implementation.
The source now registers ownership before immediate invocation and preserves scan coalescing without changing that assertion.
Independent review found a cancellation window before Promise cleanup completed.
A failing regression preceded the final settlement fix.
The regression inspects the native Promise boundary and distinguishes pending cancellation from an already completed value.
The focused command passed 45 tests on macOS.
The same command passed 45 tests on Linux with the Node 24 Bookworm image.
Linux used a read-only checkout and no external network.
The final complete Shell command passed 1065 tests and skipped two tests.
Independent review passed 67 relevant tests after the fix without material findings.

An initial Linux command passed 43 tests and failed the deployed collector check because its image lacked process inspection.
These checks do not establish independent Pi source replacement parity, active native request cancellation, deployed hosts, or physical device acceptance.

## Pi SSH child cancellation verification

The SSH cancellation checks ran on 2026-10-08.
The Pi Sessions source now passes its active cancellation signal to the existing native child launcher.
It retains the existing SSH arguments, deadline, output bound, and kill signal.
An early abort callback cannot certify child release.
Stop waits for child close before the source releases its pending read.
The [architecture contract](ARCHITECTURE.md#current-shell-plugin-composition) owns the completion boundary and Open DeskOS Link limits.

A failing regression preceded implementation.
The [lifecycle checks](../tests/pi-source-lifecycle.test.js) exercise an abort callback before a controlled close event.
They also start an actual Node child through the native launcher without connecting to SSH.
Parent cancellation kills that process, and source stop waits for its close event.
The fixture removes only its own child process.
Normal valid snapshots and SSH diagnostic responses retain their existing tests.
Injected callback-only launchers retain their compatibility path without claiming native process acceptance.

The focused commands passed 47 tests on macOS and 47 tests on Linux.
Linux used Node 24 Bookworm with a read-only checkout and no external network.
Independent review passed 35 source and lifecycle tests and the source syntax check without blocking findings.
Additional review fixtures verified both callback orders, close-listener release, and callback-only cancellation compatibility.
One complete concurrent command failed the real Electron package rollback verification.
The isolated Electron command passed without changing its verifier or assertions.
The final complete Shell command passed 1067 tests and skipped two tests.

These checks do not establish real SSH collector compatibility, Open DeskOS Link transport cancellation, native Windows behavior, or CM5 acceptance.

## Open DeskOS Link request cancellation verification

The Open DeskOS Link cancellation checks ran on 2026-10-08.
Pi Sessions and Pi Events pass local cancellation signals to their individual Open DeskOS Link requests.
Each native request retains its connection until socket close.
Cancelling one request preserves independent requests through the shared client.
Client stop cancels all owned requests and waits for their completion.
Stopped and previously cancelled requests create no new connection.
Cancellation suppresses late responses and transport errors without suppressing ordinary transport errors.
Protocol records and authentication retain their existing contracts.
Cancellation signals remain local and do not enter protocol records.

The [lifecycle checks](../tests/odk-link-lifecycle.test.js) use temporary Unix sockets and controlled transport promises.
The [Pi Events integration check](../tests/pi-result-events.test.js) verifies signal propagation, existing request fields, fallback, and stop cancellation.
The earlier focused commands passed 119 tests on macOS and 119 tests on Linux.
After updating the integration assertion, the affected commands passed 33 tests on each host.
Linux used Node 24 Bookworm with a read-only checkout and no external network.
Independent review passed 116 checks and skipped one Windows-only check without findings.
The first complete Shell command exposed an old integration assertion that excluded the new local signal.
The updated assertion checks that signal separately and preserves the existing request fields.
The final complete Shell command passed 1072 tests and skipped two tests.
Source syntax checks and the whitespace check passed.

These checks do not establish native Windows named-pipe cancellation, deployed Open DeskOS Link compatibility, CM5 behavior, or physical input acceptance.

## Development replacement repair verification

The replacement repair checks ran on 2026-10-08.
A missing declaration in an independent selected link no longer prevents valid Main replacement linking.
The CLI reports the damaged plugin identity without exposing its source path or error content.
It preserves the damaged link preference and remaining source files.
Candidate trust, grants, public ports, and dependency validation retain their existing checks.
A candidate that requires the missing provider fails without changing configuration bytes.
Link validation does not execute development entries.

The [regression check](../tests/development-plugins.test.js) reproduced the failure before the CLI change.
The focused macOS command passed 48 tests, including real Electron package verification.
The Linux configuration, discovery, and replacement command passed 38 tests.
Linux used Node 24 Bookworm with a read-only checkout and no external network.
The first macOS command exposed a new test assertion that did not use the canonical saved path.
The corrected assertion uses the existing real-path contract.
The first Linux command also included the Electron package fixture, which failed in that container.
The final Linux command excludes that fixture; macOS provides its successful verification.
Independent review passed 20 development checks without findings.
Additional review fixtures checked valid extension retention and atomic rejection of a missing candidate grant.
The final complete Shell command passed 1073 tests and skipped two tests.
Source syntax checks and the whitespace check passed.

These checks do not establish native distribution, live replacement, deployed host behavior, or physical device acceptance.

## Pi source replacement verification

The Pi source replacement checks ran on 2026-10-08.
The [shared acceptance checks](../tests/pi-plugin-parity.test.js) exercise default and independently linked Pi Sessions and Pi Events factories.
The [Sessions factory](../tests/fixtures/pi-sessions-replacement/entry.cjs) owns source construction, IPC registration, readings, and cleanup.
The [Events factory](../tests/fixtures/pi-events-replacement/entry.cjs) owns source construction, request validation, IPC registration, and cleanup.
Neither factory invokes the built-in plugin factory.
The Sessions factory reuses the existing source library and controlled provider fixtures.
The later Events implementation follows the [independent Events contract](PI_EVENTS_PLUGIN_CONTRACT.md).
The actual CLI links their declarations with explicit trust, replacement selection, and matching grants.

Shared scenarios verify local IPC snapshots and Open DeskOS Data identity, availability, counts, and session projection.
They verify Reported Sessions precedence and authoritative Hosted Pi identity collisions without starting the local collector.
Events retain their request validation, permitted local fallback reasons, authoritative failure responses, and ordinary rejection behavior.
Disabling one source preserves the shared Open DeskOS Link and the other source.
Reactivation waits for pending reads and suppresses their late results before creating a new source instance.
CLI removal preserves external entry bytes and restores default selection.
The first command confirmed that external replacement fixtures were missing.
An initial projection assertion omitted the existing null activity field; the corrected assertion preserves that field.
The focused commands passed 71 tests on macOS and 71 tests on Linux.
Linux used Node 24 Bookworm with a read-only checkout and no external network.
Independent review identified two acceptance gaps, which the updated checks resolve.
Default restoration now starts through the original configuration after CLI removal.
Hosted identity now wins against a newer Reported Session with activity.
The reviewer reran all 13 parity checks without further material findings.
The final complete Shell command passed 1086 tests and skipped two tests.
Fixture syntax, documentation references, sentence limits, and the whitespace check passed.

These checks do not establish alternative collectors, live Pi machines, native Windows behavior, CM5 acceptance, or renderer interaction parity.

## Main runtime control verification

Startup selection checks completed on 2026-10-10 with 85 affected tests passing and no failures or skips.
The [selected fixture](../tests/fixtures/plugin-control-replacement.js) owns listener creation and cleanup through the existing Main composition.
It shares the existing command policy and authenticated transport; it does not invoke the default plugin factory.
Default and selected factories preserve inventory, CLI lifecycle receipts, token authentication, protected targets, and configuration bytes.
Disabling management releases its listener while managed ports remain available; enabling management creates a fresh signal and listener.
These checks establish local startup selection of the channel adapter while sharing the existing command policy.
Read [joint production Main verification](#external-runtime-diagnosis-replacement) for actual development loading, inventory, CLI operations, and shutdown evidence.
No production interface or implementation changed for this verification.

Run this command from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/plugin-control.test.js tests/plugin-cli-management.test.js tests/plugin-runtime-management.test.js tests/plugin-runtime-preferences.test.js tests/main-plugin-replacement.test.js tests/plugin-host.test.js tests/plugin-diagnostics.test.js
```

The [control plugin](../src/plugin-control.js) provides a separate authenticated local management channel.
The CLI accepts explicit `--runtime` enable and disable operations without writing startup preferences.
The host retains its dependency ordering, cancellation, cleanup retry, and resource ownership rules.
The control plugin refuses self-disable and unknown identities.
Lifecycle failure produces a bounded error without exposing private exception content.
The diagnosis channel remains read-only.
Main disables the control plugin when its endpoint is unavailable or smoke mode is active.

The [control checks](../tests/plugin-control.test.js) use temporary channels and private configuration.
Cancelled control rejects new mutations.
Missing, object, and empty failure errors report an unknown operation outcome without replay.
The malformed receipt regression failed before the shared client validation change.
The earlier Linux command passed 51 tests on 2026-10-08 using Node 24 Bookworm with a read-only checkout and no external network.
That result predates selected channel checks and excludes the Electron installation fixture.
The [current status](#scope-and-status) owns complete Shell results and input freshness.

These checks do not establish cross-runtime live management, renderer interaction, deployed host behavior, native Windows control, or physical device acceptance.

## Remote Bridge runtime control verification

The Bridge runtime control checks ran on 2026-10-08.
Both Bridge entry points register a separate control plugin through the common host.
The shared dispatcher accepts only registered transport targets.
It refuses listener and control identities without changing their state.
The CLI routes `odk.remote.` runtime operations to this separate endpoint.
Transport changes retain existing lifecycle, cleanup retry, priority, fallback, and event contracts.
The input connection does not carry management records.
The control channel uses the shared local ownership and token authentication rules.

The [control checks](../../../integrations/remote-bridge/test/runtime-control.test.js) execute the actual CLI against both local Bridge entry points.
They verify stop, restart, subscription release, listener retention, independent transports, bounded cleanup errors, and unchanged preferences.
The endpoint fixture checks Linux, macOS, and Windows logical names without claiming native Windows execution.
The [release fixture](../../../integrations/remote-bridge/test/plugin-lifecycle.test.js) copies the actual Shell source dependencies into the immutable layout.
The initial commands exposed catalog assertions that omitted the new control plugin and a release fixture tied to the working directory.
The updated checks include the control identity and use paths relative to their test file.
One Linux command failed before execution because the host shell could not expand the test paths from its working directory.
The corrected commands passed 75 tests on macOS and 75 tests on Linux.
Linux used Node 24 Bookworm with a read-only checkout and no external network.
Independent review identified a Windows endpoint mapping mismatch and confirmed its correction.
The reviewer passed 97 lifecycle and control checks, plus 49 shared authentication checks with one Windows-only skip.
The final complete Shell command passed 1091 tests and skipped two tests.
Source syntax, documentation references, sentence limits, and the whitespace check passed.

These checks do not establish physical transport handover, deployed hosts, native Windows Bridge operation, or firmware management.

## Resident reversible lifecycle verification

The resident lifecycle checks ran on 2026-10-08.
The composition exposes local enable operations through the common host.
Agent runtime cleanup now suspends voice work during partial lifecycle changes instead of closing its service and channel providers.
Complete resident shutdown retains its established channel, Agent cancellation, service, and Agent resource release order.
Service resume replaces the cancellation signal only after suspension succeeds.
Permanent close prevents reopening.
Capture identity guards suppress old recording completion after a later capture starts.
Failed suspension retains recording ownership and supports cleanup retry.
Late acquisition and late submission cleanup cannot remove that retained ownership.
Older services without suspension methods reject partial service, channel, and runtime changes before graph mutation.
Their complete shutdown and startup compatibility remain covered.

The [service checks](../../../integrations/personal-bot/tests/service.test.mjs) use controlled recording and prompt promises without capture or model calls.
The [composition checks](../../../integrations/personal-bot/tests/plugin-composition.test.mjs) verify provider identity and full shutdown ordering.
New feature and cleanup regressions failed before their corresponding changes.
Independent review found delayed capture retention, permanent close retry, transitive compatibility, late submission, and cleanup timing gaps.
The updated tests reproduce those failures and verify their corrections.
The final focused commands passed 51 tests on macOS and 51 tests on Linux.
Linux used Node 24 Bookworm with a read-only checkout and no external network.
The reviewer reran 51 checks and independent timing reproductions without remaining findings.
The complete Personal Bot command passed 564 tests and skipped two tests.
Personal Bot type checking passed.
The final complete Shell command passed 1091 tests and skipped two tests.
Source syntax, documentation references, sentence limits, and the whitespace check passed.

These checks do not establish resident CLI management, deployed hosts, real Agent behavior, physical recording, or native Windows acceptance.

## Resident runtime control verification

The resident management checks ran on 2026-10-08.
The resident entry registers an independent authenticated control plugin through the common host.
The unified CLI routes resident identities to its separate endpoint.
Runtime changes preserve the voice service and channel providers.
Service and channel changes retain the control endpoint for recovery.
The control plugin refuses its own identity and unknown components.
Lifecycle failures return bounded errors without private details.
Runtime operations do not write startup preferences.

The [control checks](../../../integrations/personal-bot/tests/runtime-control.test.mjs) use actual CLI commands against temporary resident compositions.
They exercise dependency cleanup, restart, provider identity, failed cleanup recovery, and endpoint removal.
Endpoint checks compare Linux, macOS, and Windows names with the Shell Host mappings.
Token checks use a temporary Unix socket with token authentication enabled.
An incorrect token cannot invoke component cleanup.
These token checks do not exercise native Windows pipes.
Provider startup failures and saved disable preferences retain successfully started management.
Management starts before Agent initialization and can cancel cooperative initialization through the runtime signal.
Both startup recovery gaps failed their regression checks before correction.
The focused commands passed 59 checks on macOS and 59 checks on offline Linux.
Linux used Node 24 Bookworm with a read-only checkout.
The complete Personal Bot command passed 572 checks and skipped two checks.
Personal Bot type checking passed.
The complete Shell command passed 1091 checks and skipped two checks.

Independent review found the startup recovery and management readiness gaps.
The reviewer passed 16 runtime and composition checks after their correction without remaining actionable findings.
The later default Agent initialization checks cover signal propagation and session cleanup.

These checks do not establish deployed management, real Agent parity, physical capture, or native Windows acceptance.

## Default Agent initialization cancellation verification

The default Agent initialization checks ran on 2026-10-08.
The resident entry passes its runtime component signal to the default Agent initializer.
Model runtime setup and credential availability checks receive the same signal through their supported SDK options.
Cancellation checks prevent later startup stages after pending operations settle.
Late session acquisition and extension binding failure abort and dispose the acquired session before initialization rejects.
The startup abort listener is removed after successful initialization or cleanup.

The [Agent checks](../../../integrations/personal-bot/tests/agent.test.mjs) use injected model and session resources without model calls.
Six startup regressions cover pre-cancellation, model setup, credential availability, late session acquisition, pending binding, and binding failure.
The original five checks failed before implementation.
Independent review found missing model-operation signal propagation.
The updated model fixtures receive the actual signal and finish only when it is aborted.
The reviewer passed six startup checks and type checking without remaining actionable findings.
Focused Agent, runtime control, and composition commands passed 43 checks on macOS and 43 checks on offline Linux.
Linux used Node 24 Bookworm, a read-only checkout, and an executable temporary filesystem for fixture helpers.
An earlier Linux command failed because its temporary filesystem prevented helper execution.
The first complete Bot command found five source-extraction assertions tied to the previous initializer signature.
Updated extraction retains the transcription configuration scenarios with the additional cancellation parameter.
All 16 startup checks then passed.
The final complete Personal Bot command passed 578 checks and skipped two checks.
Personal Bot type checking passed.
The complete Shell command passed 1091 checks and skipped two checks.

These checks do not establish immediate interruption of SDK session creation or extension binding.
Initialization retains pending acquisition until it settles before cleanup completes.
Real model behavior, deployed residents, and physical voice acceptance remain unverified.

## Runtime management ownership verification

The runtime ownership checks ran on 2026-10-08.
The common management dispatcher exposes a read-only inventory of component identities and host types.
Its inventory omits private errors, readings, Agent content, and input records.
The [CLI resolver](../src/plugin-runtime-management.js) reads authenticated inventories from Main, Bridge, and resident endpoints before mutation.
It selects the unique online owner instead of interpreting identity prefixes.
An unavailable independent endpoint does not prevent selection of a uniquely reported online owner.
Ambiguous identities, malformed inventories, oversized responses, and online inventory failures refuse selection.
Rejected asynchronous inventory callbacks are consumed and refused.
Bridge inventory includes protected infrastructure identities while its mutation snapshot remains restricted to transports.
Existing mutation receipt validation and unknown-outcome handling remain unchanged.

The [resolver checks](../tests/plugin-runtime-management.test.js) exercise ownership, ambiguity, invalid reports, bounds, and private-data exclusion.
The actual CLI manages a Main fixture with a resident-style identity through its declared Main ownership.
That regression failed before prefix routing was removed.
Independent review found an oversized-response classification gap.
Its regression and the asynchronous inventory and online failure checks failed before their corresponding corrections.
The reviewer passed 17 focused resolver and control checks without remaining findings.
Combined Shell, Bot, and Bridge fixtures passed 47 checks on macOS.
Linux passed 37 management and lifecycle checks with Node 24 Bookworm, no network, and a read-only checkout.
An earlier Linux command failed its HTML installation fixture because the checkout contains macOS Electron dependencies.
The Linux management command excludes those separate Electron installation checks.
An initial complete Shell command also failed an Electron installation fixture and an online-failure regression before its correction.
The final complete Shell command passed 1103 checks and skipped two checks.
The complete Personal Bot command passed 578 checks and skipped two checks.
Personal Bot type checking passed.
The complete Bridge JavaScript command passed 65 checks.

These checks do not establish deployed inventories, native Windows management, firmware control, or full plugin distribution.
Python, renderer, and firmware still need applicable live management integration.

## Hosted Pi runtime management verification

The Hosted Pi management checks ran on 2026-10-08.
Its daemon registers an independent authenticated management plugin when the Shell Host resolves its endpoint.
The unified CLI reads its identity inventory beside Main, Bridge, and resident management inventories.
Management starts before task initialization and remains available after provider failure or saved disable preferences.
The management plugin refuses self-disable and leaves startup preferences unchanged.
Task control retains its existing protocol and separate listener.

Partial service stop withdraws the endpoint and drains existing Console connections while retaining the accepting listener.
The transport waits for asynchronous disconnect cleanup and retains failed operations for retry.
Each connection retains its owning service until disconnect cleanup succeeds.
Partial and complete shutdown retain the service while disconnect cleanup remains incomplete.
Full shutdown preserves independent service cleanup after ordinary listener closure failure.
Listeners without connection draining reject partial listener and service operations before graph mutation.
Failed endpoint withdrawal retains its provider until removal can retry.

The [management checks](../../../integrations/personal-bot/tests/task-runtime-control.test.mjs) execute actual CLI operations against temporary compositions.
They cover failed startup recovery, saved listener disable, authentication, provider identity, endpoint publication, and shutdown.
The [composition checks](../../../integrations/personal-bot/tests/task-composition.test.mjs) use the real task transport for attached Console and asynchronous disconnect scenarios.
The [development checks](../../../integrations/personal-bot/tests/task-development-plugins.test.mjs) start the actual daemon with external task factories and manage its service through the CLI.
The initial lifecycle, management, endpoint withdrawal, and disconnect regressions failed before their corresponding corrections.
An initial complete command found a catalog assertion that omitted the new management plugin.
The updated assertion preserves replacement versions and checks the separate management identity.
Independent review found retained Console sockets, asynchronous disconnect draining, and full shutdown retry gaps.
Each gap has regression coverage.
The reviewer passed 16 targeted checks after correction without remaining findings.
Focused commands passed 29 checks on macOS and 29 checks on offline Linux.
Linux used Node 24 Bookworm with a read-only checkout and an executable temporary filesystem.
Personal Bot type checking passed.
The final complete Personal Bot command passed 587 checks and skipped two checks.
The final complete Shell command passed 1103 checks and skipped two checks.

These checks do not establish deployed Hosted Pi management, real task session parity, native Windows pipes, or device acceptance.

## Python resource owner thread verification

The Python lifecycle checks ran on 2026-10-08.
The constructing thread owns the synchronous Host, runtime, and plugin contexts.
Foreign-thread calls fail before reading owned state, changing resources, or clearing retained errors.
Runtime `run()` checks ownership before its cleanup guard can call `close()`.
The owner can still disable, restart, diagnose, and release the selected composition.

The [owner tests](../../../integrations/futu-poller/tests/test_plugin_host.py) cover Host, context, and runtime entry points.
The initial Host and runtime regressions failed before their corresponding corrections.
Independent review found that runtime wrappers cleared errors before checking ownership.
The corrected wrappers passed all three error-preservation regressions.
The reviewer passed 79 related checks without further actionable findings.

The complete Python suite passed 217 tests on macOS and Linux with runtime warnings treated as errors.
Linux used Python 3.11 and Node 24 Bookworm with read-only source and disabled external networking.
An initial Python-only container passed 65 focused tests but could not run the Shell validator without Node.
The final Linux command includes that validator and the complete Python suite.
Python syntax checks and `git diff --check` passed.

These checks do not establish live Python management, SDK interruption, real gateway behavior, deployed hosts, or device acceptance.
Future management operations must execute on the resource owner thread.

## Python management command contract verification

The Python command checks ran on 2026-10-08.
The [dispatcher](../../../integrations/futu-poller/plugin_control.py) applies common inventory, enable, and disable commands on the resource owner thread.
Inventory exposes only component identities and host types, within the common count and byte limits.
Lifecycle results report actual selected component state and exclude private failure details.
Rejected commands preserve owned resources and saved startup preferences.
Cleanup failures retain resource ownership for explicit retry.

The [control checks](../../../integrations/futu-poller/tests/test_plugin_control.py) compare Python results with the actual JavaScript dispatcher.
They also exercise real Host transitions, independent resource preservation, blocked dependencies, and cleanup failure retries.
Independent review found that an oversized valid identity could produce an oversized success result.
A real Host regression failed before the request budget correction.
The dispatcher now refuses requests above 4 KiB before lifecycle mutation, matching the existing JavaScript transport budget.
The reviewer passed 19 control checks and isolated malformed-request checks without further actionable findings.

The complete Python suite passed 236 tests on macOS and Linux with runtime warnings treated as errors.
Linux used Python 3.11 and Node 24 Bookworm with read-only source and disabled external networking.
Python syntax checks and `git diff --check` passed.

This dispatcher does not open or authenticate a management endpoint.
Independent transport integration, owner-thread request scheduling, and actual CLI runtime operations remain unfinished.
These checks do not establish deployed management, real SDK behavior, native Windows channels, or physical device acceptance.

## Python independent management transport verification

The Python transport checks ran on 2026-10-08.
The [channel](../../../integrations/futu-poller/management_channel.py) provides a separate nonblocking Unix listener that dispatches commands on its constructing thread.
The Shell runtime resolver includes the `futu-plugin-control` inventory with the `python-agent` host identity.
Private directory ownership gates Unix access, and token-gated listeners verify the common handshake before dispatch.
The listener limits request bytes, connection count, waiting intervals, and response bytes.
Foreign-thread polling and closure fail before changing owned resources.

The [transport checks](../../../integrations/futu-poller/tests/test_management_channel.py) run actual CLI disable and enable commands against a controlled Python composition.
They verify resource cleanup and restart without writing startup preferences.
Malformed envelopes, incorrect tokens, extra records, and oversized frames cannot dispatch commands.
An idle client does not block an independent request.
Failed startup releases a successfully bound endpoint.

Independent review found expired response delivery and stale-socket restart failures.
Both regressions failed before their corrections.
Response delivery now receives a fresh interval after synchronous dispatch.
Restart checks socket type, UID, listener availability, and pathname identity before removing a stale owned socket.
Active listeners and unrelated files remain intact.
The reviewer passed 34 transport and control checks without further actionable findings.

The complete Python suite passed 251 tests on macOS and Linux with runtime warnings treated as errors.
Linux used Python 3.11 and Node 24 Bookworm with read-only source and disabled external networking.
The focused Shell command passed 24 tests on macOS, including Python diagnosis interoperability.
The complete macOS Shell command passed 1103 tests and skipped two tests without failures.
Linux passed 21 resolver, control, and configuration checks.
Python syntax checks and `git diff --check` passed.

The operational Python entry does not yet register or schedule this listener.
Selected-loop supervision and recovery must preserve publication behavior during live component changes.
Windows named-pipe listening, deployed operation, real SDK behavior, and device acceptance remain unfinished.

## Python operational management supervision verification

The operational Python checks ran on 2026-10-08.
An absolute Unix runtime directory selects an independent protected control plugin before feature startup.
An explicit control path overrides automatic selection, and an empty path disables it.
Failed provider startup retains a successfully started manager for explicit recovery.
The default wait capability pumps management commands on the resource owner thread between publications.
Lifecycle changes cancel the old loop before the supervisor selects another generation.
Disabled or normally returned loops retain management without restarting themselves.
Without a management endpoint, the existing single-run behavior remains effective.

The [operational checks](../../../integrations/futu-poller/tests/test_runtime_control.py) run the actual Python entry and actual CLI without SDK access.
They disable and enable publisher, loop, gateway, and transport components while preserving the manager.
They verify unchanged authentication records, protected control, absent preference writes, and normal endpoint cleanup.
Controlled generation checks prohibit old publisher use after release.
Controlled timing checks verify that repeated inventory requests do not reset the publication deadline.
Provider recovery retains the original control instance.

Independent review found an incomplete copied-deployment module list.
A managed-copy regression failed before the deployment list correction.
The guide now requires the main script and all four auxiliary modules.
Copied deployments pass with and without a runtime directory while retaining stdout protocol records.
The reviewer passed five runtime checks and two copied-deployment checks without further actionable findings.

The complete Python suite passed 257 tests on macOS and Linux with runtime warnings treated as errors.
Linux used Python 3.11 and Node 24 Bookworm with read-only source and disabled external networking.
The affected Shell commands passed 22 checks on each host.

Blocking SDK operations remain synchronous and delay management until they return.
External loops require cooperative use of the declared wait capability and cancellation signal.
Arbitrary external loop exceptions still exit the operational process.
Windows named-pipe listening, real gateway behavior, deployed-host management, and physical acceptance remain unfinished.

## Python managed execution failure verification

The Python execution failure checks ran on 2026-10-08.
The Host can retire a failed running activation and its dependent consumers without restarting the failed component.
It releases consumers before their provider and preserves independent resources.
Failed release retains ownership and requires an explicit lifecycle retry.
Public runtime reports exclude private execution errors.

The supervisor retains management when a selected loop raises a synchronous execution error.
The CLI can enable a new activation after cleanup succeeds.
Without management, the same loop error retains the original error exit and cleanup behavior.
The Host provides an opaque activation token independent of port object identity.
Exception attribution, supervisor waits, and publication waits compare that token.

The [Host checks](../../../integrations/futu-poller/tests/test_plugin_host.py) verify dependency release order, cleanup retries, independent resources, and thread ownership.
The [runtime checks](../../../integrations/futu-poller/tests/test_runtime_control.py) verify controlled faults and actual external replacement recovery through the CLI.
Initial managed fault regressions failed before implementation.
Independent review found that a reusable port object could misattribute an old exception to its replacement.
Both the exception and wait regressions failed before the activation-token correction.
The reviewer passed the complete 267-test Python suite without further actionable findings.

The complete Python suites passed 267 tests on macOS and Linux with runtime warnings treated as errors.
Linux used Python 3.11 and Node 24 Bookworm with read-only source and disabled external networking.
The affected macOS Shell command passed 17 diagnosis, health, and runtime resolver checks.
Python syntax, new document references, sentence lengths, and `git diff --check` passed.

These results establish cooperative local execution recovery without SDK or gateway access.
Blocking calls still delay management, and Windows listening, deployed operation, and physical acceptance remain unfinished.

## Python management startup isolation verification

The management startup isolation checks ran on 2026-10-08.
A failed control plugin remains visible in diagnosis without stopping independent polling components.
When management is unavailable, startup still raises the original feature error after shutdown.
The failed control error cannot mask a simultaneous publisher failure.

The [runtime checks](../../../integrations/futu-poller/tests/test_runtime_control.py) cover occupied endpoints and unsafe management directory permissions.
They retain authentication records, the original interval, independent component states, and normal cleanup.
The existing file and directory permissions remain intact.
The [copied entry checks](../../../integrations/futu-poller/tests/test_composition.py) cover absent, available, and occupied management selection.
All three preserve stdout protocol records without loading the SDK.
The three initial isolation regressions failed before the startup correction.
Independent review passed 29 runtime and composition checks without actionable findings.

The complete Python suites passed 271 tests on macOS and Linux with runtime warnings treated as errors.
Linux used Python 3.11 and Node 24 Bookworm with read-only source and disabled external networking.
Python syntax, new document references, sentence lengths, and `git diff --check` passed.

These results establish local failure isolation without real SDK, deployed-host, Windows management, or physical acceptance.

## Python Windows management backend verification

The Windows backend checks ran on 2026-10-08.
The [channel](../../../integrations/futu-poller/management_channel.py) uses raw byte-mode named pipes and owner-thread overlapped I/O completion.
Unix and Windows share bounded handshake, envelope, and response parsing.
Windows requires a token before it creates a pipe listener.
The selected endpoint matches the Shell `futu-plugin-control` identity.
The shared token path and explicit overrides follow the [Python guide](../../../integrations/futu-poller/README.md#local-component-plugins).

The backend uses the inspected [CPython 3.13.10 wrapper](https://github.com/python/cpython/blob/v3.13.10/Modules/_winapi.c).
Its first-instance flag refuses an already claimed pipe name, and byte-mode flags reject remote clients.
Pending connect, read, and write operations remain on the resource owner thread.
Partial writes retain the remaining response bytes.
Failed or incomplete cancellation retains the operation, buffers, and handle for retry.

The [controlled API checks](../../../integrations/futu-poller/tests/test_windows_management.py) verify authenticated dispatch, fragmented input, idle peers, partial writes, conflicts, and cancellation retry.
They also verify Windows composition selection and the shared token location.
Independent review found a terminal native error that retained disconnected pipe handles indefinitely.
A raised broken-pipe regression failed before the terminal completion correction.
The reviewer passed 29 Windows-model and Unix checks and skipped the native Windows check without further blocking findings.

The complete Python suites passed 285 tests and skipped one native Windows check on macOS and Linux.
Both commands treated runtime warnings as errors.
Linux used Python 3.11 and Node 24 Bookworm with read-only source and disabled external networking.
The affected macOS Shell command passed 22 diagnosis, health, resolver, and Windows channel checks.
Python syntax, new document references, sentence lengths, and `git diff --check` passed.

The native Windows check runs the actual Node client against the native pipe backend on Windows.
It remains unexecuted on this macOS host and is skipped in the Linux container.
Controlled completion results do not establish Windows pipe, device, deployed service, or gateway acceptance.

## Renderer release ownership verification

The renderer release checks ran on 2026-10-08.
Surface release retains failed unmount work and scoped cleanup callbacks until a later release succeeds.
Successful callbacks and completed unmount operations do not repeat during retry.
The element and factory resources remain owned while release fails or waits.
The factory catalog reports `cleanup-failed` after unsuccessful shutdown.
Independent plugins can still release their resources.

The [registry checks](../tests/renderer-plugin-host.test.js) cover synchronous failures, asynchronous rejection, concurrent release requests, partial mounts, and cleanup reentrancy.
The initial unmount and cleanup regressions reported `stopped` before the ownership correction.
Independent review found duplicate cleanup during a reentrant failed-mount release.
That regression failed before release ownership moved ahead of callback execution.
The reviewer passed 52 renderer, App, and common Host checks without further actionable findings.
The [robustness check](../tests/shell-robustness.test.js) now awaits the release result and verifies cleanup after failed unmount.

The complete macOS Shell suite passed 1109 tests and skipped two platform checks.
The hidden local Electron replacement fixture reported 30 renderer plugins and completed Clock shutdown in lifecycle order.
The configuration inventory also passed after the Python management endpoint received its missing document entry.
JavaScript syntax, document references, changed sentence lengths, and `git diff --check` passed.

These checks establish local release retention and retry without live capture or production access.
They do not establish renderer runtime enable operations, production hot replacement, CM5, Windows-device, or physical acceptance.

## App release retry verification

The App release checks ran on 2026-10-08.
The platform retains its runtime reference after unsuccessful surface release.
Failed close and switch requests retain the original foreground without mounting the target.
The close error Retry calls the same owned shutdown path as Back.
Failed partial mounts retain the target and report a failed local foreground until cleanup succeeds.
Foreground recovery cannot overwrite an element that still owns resources.

The [App checks](../tests/app-platform.test.js) cover direct close, switching, dialog Retry, and partial mount failures through the real registry.
The initial close and switch regressions failed before runtime reference retention.
Independent review found discarded partial-mount ownership and a dialog Retry that bypassed surface release.
Both additional regressions failed before the recovery corrections.
The reviewer passed 66 App, endpoint, renderer, and common Host checks without further actionable findings.
An independent real-registry probe also released the failed target and reopened the original App after retry.

The complete macOS Shell suite passed 1116 tests and skipped two platform checks.
The hidden local Electron replacement fixture reported 30 plugins and completed the existing Clock lifecycle.
JavaScript syntax, changed document sentence lengths, file references, and `git diff --check` passed.

These checks establish local App ownership and recovery without production access or live capture.
The Electron fixture does not exercise rendered App error dialogs.
Renderer runtime enable operations, rendered Retry interactions, CM5, Windows-device, and physical acceptance remain unverified.

## Renderer runtime lifecycle verification

The renderer lifecycle interface checks ran on 2026-10-08.
The registry exposes programmatic enable and disable operations through the existing Host dependency graph.
Affected surfaces release before factory shutdown.
Independent plugins retain their running factories.
Failed cleanup retains dependent factories and supports later retry.
New mounts cannot enter an affected transition or use an aborted context.
The selected replacement definition remains unchanged after enable operations.

Mounted affected Apps must close through the App platform before lifecycle changes.
The registry checks this boundary before cancellation, including optional dependency consumers.
Independent review found bypasses through repeated startup configuration and reentrant App mounting.
Both regressions failed before those paths received the same ownership checks.
The reviewer passed 28 registry checks without further actionable findings.
The combined renderer, App, Host, and robustness command passed 73 checks.

The complete macOS Shell suite passed 1124 tests and skipped two platform checks.
The hidden local Electron fixture disabled the selected Clock, refused its disabled mount, enabled it, and mounted a fresh reading.
Its shutdown trace retained factory and surface ordering across both activations.
The disabled Camera state remained unchanged.
JavaScript syntax, changed document sentence lengths, file references, and `git diff --check` passed.

The composition owner still must reconcile placement and foreground state before operator management can use this interface.
These checks do not establish automatic desktop restoration, authenticated renderer management, runtime CLI integration, or production hot replacement.
CM5, Windows-device, physical input, and assistive-technology acceptance remain unverified.

## Renderer placement restoration verification

The renderer placement checks ran on 2026-10-08.
The [registry](../src/renderer/core/registry.js) now restores previously mounted Widget, Page, and status containers after runtime factory changes.
The [guide](AI_PLUGIN_GUIDE.md#programmatic-runtime-lifecycle) owns restoration and removal rules.
The initial three surface regressions failed before release cleared content and enable operations restored their placements.
Two additional regressions reproduced skipped sibling recovery and successful reports for retained failed mounts.
Those regressions passed after independent recovery attempts and retained failure checks.

The [registry checks](../tests/renderer-plugin-host.test.js) verify original UI contexts, fresh factory signals, retained placement attributes, and dependency recovery.
They cover cleanup failure, manual removal, disconnected elements, restoration failure, and Shell shutdown during recovery.
Independent review passed 37 registry checks without actionable findings.
Additional reviewer probes verified concurrent disable and enable operations and removal racing with disable.

The complete macOS Shell suite passed 1133 tests and skipped two platform checks.
The hidden local Electron fixture reported 30 plugins and automatically restored the selected Clock after enabling its factory.
It verified empty content after disable, the same container after enable, a fresh reading, and both lifecycle shutdown sequences.
The disabled Camera state remained unchanged.
JavaScript syntax, changed document sentence lengths, file references, and `git diff --check` passed.

These checks establish local restoration for previously mounted surfaces without production access or live capture.
They do not establish initially excluded placement creation, pager reconciliation, foreground App restoration, or authenticated runtime CLI integration.
CM5, Windows-device, physical input, and assistive-technology acceptance remain unverified.

## Desktop runtime reconciliation verification

The desktop reconciliation checks ran on 2026-10-08.
The [composer interface](AI_PLUGIN_GUIDE.md#programmatic-desktop-reconciliation) creates declared containers that were excluded during startup.
Existing Widget, Page, and installed package containers retain their identities.
Excluded placements wait for release before removal.
The initial creation and release regressions failed before the interface existed.

Independent review found a retained node that remained inactive after cleanup failure and factory recovery.
Its regression failed before inclusion checked the [registry instance state](../src/renderer/core/registry.js).
Reconciliation now retries release and mounts recovered inactive containers.
Preflight checks also reject changed page ownership and missing base grids before cleanup.
The [runtime checks](../tests/composer-runtime.test.js) cover these paths through the actual registry and controlled DOM nodes.
The reviewer passed 46 composer, placement, and registry checks without further actionable findings.

The complete macOS Shell suite passed 1137 tests and skipped two platform checks.
The hidden local Electron fixture removed Clock through reconciliation and recreated it after factory enable.
It verified a fresh reading, preserved Almanac identity, and continued Camera exclusion.
JavaScript syntax, changed document sentence lengths, file references, and `git diff --check` passed.

This interface does not yet coordinate Shell pager selection or Remote page state.
Its controller still must order registry changes, reconciliation, shutdown, and full builds.
Authenticated runtime CLI integration and CM5, Windows-device, physical input, and assistive-technology acceptance remain unverified.

## State Bar runtime reconciliation verification

The State Bar reconciliation checks ran on 2026-10-08.
The [composer interface](AI_PLUGIN_GUIDE.md#programmatic-state-bar-reconciliation) creates status containers excluded during startup.
It preserves registration order, declared slots, existing containers, and unrelated slot content.
Excluded containers release resources before removal.
Failed cleanup retains ownership until retry succeeds.
Desktop and State Bar reconciliation use the same request queue.

The [regression checks](../tests/composer-runtime.test.js) failed before creation, retained cleanup recovery, and subscription release were implemented.
The Connection status plugin now tracks its unsubscribe callback through scoped cleanup.
Disable and restore operations retain exactly one active subscription.
Independent review found obsolete error markers after a failed mount recovered through registry disable and enable.
The regression failed before reconciliation cleared composer-owned markers on active recovered containers.
The correction preserves plugin-owned classes and changed titles.
The focused composer and registry checks passed 50 tests.
An earlier independent review passed 65 composer, registry, development, and diagnosis checks.
Fresh review found the error marker regression and then accepted its correction after 50 focused checks.
The complete macOS Shell suite passed 1141 tests and skipped two platform checks.

The [hidden Electron fixture](../tests/renderer-diagnosis-electron.cjs) enabled a Clock status plugin excluded during startup.
It verified a fresh reading, removal, recreation, and the retained Connection container.
The first geometry assertion measured containers with `display: contents` and failed because those containers have no layout boxes.
The corrected assertion measures visible Clock text and the Connection indicator.
Both have nonzero dimensions, remain inside the State Bar, and do not overlap the page indicator.
This local fixture does not establish CM5, Windows-device, physical input, or assistive-technology acceptance.
The [Shell runtime controller](AI_PLUGIN_GUIDE.md#shell-runtime-coordination) now coordinates lifecycle and placement changes.
The [authenticated runtime CLI](CONFIGURATION.md#explicit-runtime-management) now uses this coordinated path.

## Shell runtime controller verification

The Shell runtime controller checks ran on 2026-10-08.
The [controller](../src/renderer/core/runtime-controller.js) serializes factory changes and both placement coordinators.
The [initial scenarios](../tests/renderer-runtime-controller.test.js) failed before the controller existed.
They cover queued changes, partial reconciliation failure, App refusal, shutdown ordering, and cleanup retry.
The controller synchronizes retained placements after lifecycle failure.
Remote publication resumes only after that synchronization.

The [hidden Electron fixture](../tests/renderer-diagnosis-electron.cjs) restored a Today page excluded during startup.
It retained the selected Pi Sessions page and its container through insertion and removal of Today.
It restored an excluded Clock status plugin without changing page selection.
Removing the selected Pi Sessions page selected Usage.
Restoring Pi Sessions retained Usage selection and its empty Remote action list.
Page counts, pager controls, context text, and Camera exclusion remained consistent.

The initial fixture exposed intermediate Remote publication during Pi Sessions cleanup.
It reported the old page with withdrawn actions before placement synchronization selected Usage.
Transition suppression corrected this failure.
Remote actions now remain owned by their page elements across changing indices.
Fresh independent review accepted the correction and passed six controller checks without further actionable findings.
The focused controller, composer, and registry checks passed 51 tests.
The complete macOS Shell suite passed 1147 tests and skipped two platform checks.
JavaScript syntax, changed document sentence lengths, local references, and `git diff --check` passed.

The [authenticated renderer endpoint](CONFIGURATION.md#explicit-runtime-management) now routes CLI requests through this controller.
Native distribution, full replacement parity, CM5, Windows-device, physical input, and assistive-technology acceptance remain unverified.

## Authenticated Renderer runtime control verification

The Renderer management checks ran on 2026-10-08.
The [Main control plugin](../src/renderer-management.js) owns a separate authenticated local endpoint.
The [frame bridge](../src/renderer/core/plugin-control.js) delegates lifecycle changes to the Shell controller.
The CLI selects Renderer through its authenticated identity inventory.
Commands do not change startup preferences or appearance selections.
Only the requested current Shell main frame can return a receipt.
Multiple frames, invalid inventories, and malformed receipts prevent certification.
Requests and replies have explicit limits.
Timeout and shutdown report uncertain mutations without automatic replay.

The [initial management scenarios](../tests/renderer-management.test.js) failed before the Main control plugin existed.
A later regression exposed successful factory states with failed affected surface mounts.
Its [bridge test](../tests/renderer-control-bridge.test.js) failed before receipt checks included affected placements.
The registry now reports selected failed placements across affected consumers.
Disabled and unrelated failed placements do not prevent independent operations.
Fresh independent review accepted this correction and passed 24 bridge, composer, management, and controller checks.

The [hidden Electron fixture](../tests/renderer-diagnosis-electron.cjs) ran the actual CLI through an isolated management socket.
It enabled a Clock status plugin excluded during startup.
It disabled and restored the Clock Widget through coordinated lifecycle and placement changes.
Fresh readings, continued Camera exclusion, and absent saved preference files passed.
The initial fixture omitted its runtime parent directory and correctly failed endpoint startup.
Creating that isolated directory corrected the fixture without changing endpoint ownership checks.

The initial full suite required an updated startup exclusion assertion for the new control plugin.
It also failed an existing real Electron package verification test.
That unchanged test passed all ten checks in an isolated rerun.
The final suite exposed a test host that mapped all channel names to one User App socket.
Restricting that fixture to its intended channel removed an unintended management listener.
The complete boot fixture passed 16 checks and exited without retained sockets.
The focused management, bridge, controller, composer, registry, and boot checks passed 89 tests.
The complete macOS Shell suite passed 1158 tests and skipped two platform checks.
JavaScript syntax, changed document sentence lengths, local references, and `git diff --check` passed.
Native Windows listening, CM5, physical input, assistive technology, production distribution, and full feature replacement parity remain unverified.

### Renderer control channel startup selection

The [shared control checks](../tests/renderer-management.test.js) select default and alternative endpoint owners through existing Main composition.
The [alternative](../tests/fixtures/renderer-control-replacement.js) owns endpoint startup and cleanup without calling the default factory.
It retains the existing command dispatcher and authenticated transport; these helpers remain internal dependencies of the control plugin.
These checks establish endpoint owner replacement, not independent command dispatcher implementation.
Public inventory and actual CLI enable and disable preserve receipts and configuration bytes.
Disable cancels pending requests and removes the endpoint and report listener.
Enable creates a fresh lifetime; replies from the previous lifetime cannot complete new requests.
Controlled token checks refuse incorrect authentication before command dispatch.
They exercise token authentication over Unix fixtures, not native Windows named pipes.
The affected command passed 71 tests, failed none, and skipped one Windows check.
Paired isolated Electron runs passed actual Clock and Appearance CLI controls and returned equal fixture result objects.
Both runs released the actual report listener and endpoint during shutdown.
The selected run checks version 2.0.0 and refuses default factory execution.

```sh
node --test --test-concurrency=1 tests/renderer-management.test.js tests/renderer-control-bridge.test.js tests/plugin-runtime-management.test.js tests/local-channel.test.js tests/plugin-control.test.js
env -u ELECTRON_RUN_AS_NODE TMPDIR=/tmp node_modules/.bin/electron tests/renderer-diagnosis-electron.cjs --renderer-control
env -u ELECTRON_RUN_AS_NODE TMPDIR=/tmp node_modules/.bin/electron tests/renderer-diagnosis-electron.cjs --selected-renderer-control
```

Run these commands from `runtime/shell/`.
The [joint Main check](#external-runtime-diagnosis-replacement) subsequently selected this alternative through actual trusted development CLI links.
It checks public inventory, channel restart, actual CLI receipts, retained desktop nodes, and unchanged App state, ports, and configuration.
The [Clock Main checks](#clock-authenticated-production-main-activation) subsequently exercised signed activation and restoration through this alternative.
Supported-device acceptance remains unverified.

## Appearance factory data contract verification

The appearance factory checks ran on 2026-10-08.
The Host now executes selected trusted factories and retains their lifecycle ownership.
Preloaded packaged code can select factories before theme startup.
External appearance links retain their palette declaration contract.
The initial omission regressions reproduced factories running with incomplete port data and incomplete replacement declarations passing selection.
The Host now compares actual complete data without adding declaration defaults.
Missing fields, missing tokens, changed values, and changed font array shape fail validation.
Object key order does not affect compatibility.
Failed factories release resources before independent appearances remain available.
Cleanup retry, startup failure, port getter failure, and late creation cancellation checks passed.
The focused appearance and installed package context checks passed 33 tests.
The complete macOS Shell suite passed 1167 tests and skipped two platform checks.
Fresh independent review passed 16 appearance checks and found no actionable defects in data comparison, selection, or lifecycle ownership.
These checks do not establish rendered factory replacement, external code distribution, Windows-device, CM5, or physical input acceptance.

## Rendered appearance factory replacement verification

The hidden macOS Electron fixture ran on 2026-10-08 at 1920 by 1280.
The `--appearance-factory` mode selected an independent Pixel factory through the actual preloaded composition interface.
The selected factory reported version `3.0.0` through authenticated diagnosis.
Its lifecycle trace confirmed creation, startup, disable, resource release, and fresh creation after enable.
Disable selected Instrument without changing the saved Pixel preference.
A synthetic `pagehide` event stopped the second instance and released its scoped resources once.
The fixture awaited actual local font loading and animation frames before measurement.
All three packaged themes retained computed colors, body and Clock font roles, and Clock placement geometry against the default composition.
The initial additional assertion incorrectly assumed that Shell CSS exposes the installed package font token.
The corrected assertion measures existing rendered font roles without changing product CSS.
The `--invalid-appearance-factory` mode rejected altered font declarations before factory execution and retained default rendering.
Independent review exposed an outer-window size assumption; a new regression measured an incorrect content height of 1248 pixels.
The fixture now requests content dimensions and checks the actual 1920 by 1280 viewport before measurement.
Independent review accepted the viewport correction without additional findings.
Both Electron modes, baseline diagnosis, linked palette selection, and the 33 focused appearance checks passed.
The fixture uses temporary profiles, mocked source channels, and hidden windows without live camera or microphone capture.
These results do not establish native close delivery, glyph selection, other viewport sizes, pixel equivalence, package interaction, assistive technology, Windows-device, or CM5 acceptance.

## Authenticated appearance runtime management verification

The Renderer inventory now includes surface and appearance identities under one authenticated endpoint.
Each identity routes to its owning Host rather than a prefix-based selection.
Duplicate identities across Hosts prevent mutation.
Appearance operations use the existing theme lifecycle without surface reconciliation.
Failed startup, failed cleanup, and bridge shutdown prevent successful receipts.
The initial bridge regressions failed because appearance identities were absent from inventory and commands returned `unknown-plugin`.
The focused bridge, management, CLI, and appearance checks passed 38 tests.
The hidden Electron fixture ran actual CLI disable and enable commands against its isolated authenticated Renderer endpoint.
It verified Instrument fallback, preserved Pixel preference, restored Pixel selection, continued Camera exclusion, and absent saved operator configuration.
The complete macOS Shell suite passed 1170 tests and skipped two platform checks.
Fresh independent review passed 34 related checks without actionable findings in ownership, authentication, receipts, or shutdown handling.
These checks do not establish native Windows management, CM5, physical input, production distribution, or full replacement parity.

## Signed native revision storage verification

The [native store](NATIVE_PLUGINS.md) stages signed Shell bundles without selecting or executing their entries.
The signed inventory covers exact manifest, entry, and asset bytes.
Explicit keyring policy binds publisher keys to plugin identities and hosts.
Every stored read checks signatures, file hashes, authorization, and declarations again.
Source edits do not change retained revisions.
Failed candidates preserve retained revisions and source files.
Concurrent store instances publish one complete revision.

The initial native suite failed before the store module existed.
A new concurrent staging regression exposed a shared directory creation race.
Independent review reproduced manifest mutation between signature verification and declaration validation.
A subsequent destination-link regression exposed writes before root validation.
The store now revalidates concurrent directory creation, compares verified declarations, and checks destinations before mutation.
Directory traversal streams bounded entries and rejects unsigned directories.
Portable path validation rejects file and directory case collisions.
The manifest-swap test initially missed a macOS canonical path alias; the corrected hook exercises the intended mutation boundary.
The focused native, development, and installed package store checks passed 40 tests.
Fresh independent review passed nine native checks without remaining findings in staging or declaration reads.
The complete macOS Shell suite passed 1179 tests and skipped two platform checks.
JavaScript syntax, changed guide sentence lengths, local references, and `git diff --check` passed.

This storage module does not provide native installation, startup selection, update selection, rollback selection, or execution integrity.
Those paths remain required work rather than acceptance inferred from signatures.
Native Windows, CM5, deployed-host, and physical-device acceptance remain unverified.

## Authorized native revision selection verification

The [selection manager](NATIVE_PLUGINS.md#selection-management) records installation, update, rollback, removal, and inspection without entry execution.
Explicit trust and exact capability grants remain separate from publisher signatures.
Update retains the prior revision and its own authorization.
Rollback verifies both selected and prior revisions against current publisher policy, stored bytes, grants, and public contracts.
The configuration writer compares expected selections under its existing shared lock before publication.
Concurrent selection changes fail instead of overwriting another operation.
Concurrent enable preference changes remain preserved.
Removal preserves sources, stored revisions, and unrelated preferences.
Native selections and development links cannot own the same identity.
The new configuration schema rejects malformed authorization, unknown fields, and nested history.

The initial manager suite failed before the module existed.
The final focused manager, store, and configuration checks passed 27 tests.
Fresh independent review passed the same 27 checks without blocking findings.
The complete macOS Shell suite passed 1187 tests and skipped two platform checks.
JavaScript syntax, changed prose lengths, local references, and `git diff --check` passed.
Regression coverage includes corrupt active and prior revisions, incompatible signed history, changed public ports, and concurrent updates.
These selection APIs do not provide CLI installation commands, startup execution, rendered replacement acceptance, or deployment.
Native Windows, CM5, and physical-device acceptance remain unverified.

## Native CLI selection verification

The Plugin CLI now provides native installation, update, rollback, removal, inspection, and listing of stored selections.
Commands require explicit local publisher policy and independent installation authorization.
The policy reader validates public keys, identity and host restrictions, record shape, and file limits.
It rejects private keys and file links without printing malformed policy JSON.
CLI mutations report selection-only effects and do not execute entries.
Stored verification states remain separate from runtime lifecycle and feature health.
Listing preserves independent verified records when another revision is corrupt and exits with failure.
The Host resolves revision storage under its existing state directory.
Installed HTML commands retain their existing behavior.

The initial spawned CLI regression failed because the native command group was absent.
Independent review reproduced malformed configuration JSON fragments in the outer CLI error handler.
The new spawned regression failed before both outer handlers replaced parser details with a fixed metadata error.
The corrected command preserves invalid configuration bytes without printing their content.
The final focused CLI, publisher policy, manager, and configuration checks passed 29 tests.
Fresh independent review passed six CLI and policy checks without remaining findings.
The complete macOS Shell suite passed 1193 tests and skipped two platform checks.
JavaScript syntax, changed prose lengths, local references, and `git diff --check` passed.
Actual child processes exercised install, inspection, listing, update, rollback, removal, malformed options, missing grants, and unsigned update rejection.
They used temporary config and state directories without live runtime endpoints.
The fixtures confirmed that entries did not execute and failed updates preserved selected configuration bytes.
These commands do not provide startup loading, execution integrity, deployed-host acceptance, or complete feature replacement parity.
Native Windows, CM5, and physical-device acceptance remain unverified.

## Signed Main startup verification

The [Main loader](../src/native-plugin-loader.js) executes captured signed CommonJS inputs after Host dependency validation.
It shares the existing factory lifecycle and reading validation wrapper with development links.
Startup requires an external publisher policy through `ODK_NATIVE_KEYRING`.
Disabled, unauthorized, revoked, or corrupt selections execute no entries during discovery.
Rejected discovery preserves the default Main composition.
Factory failures retain existing Host failure behavior.

The initial loader tests failed because the loader module was absent.
Independent review found root directory resolution and overlapping native reading namespaces.
Both findings have failing regressions and repairs.
Main wiring checks exercise actual CLI selection, signed discovery, factory execution, IPC cleanup, and default behavior after corrupt revision rejection.
Controlled discovery also verifies shutdown before factory startup.
The focused loader and Main wiring checks passed 35 tests.
The complete Shell suite passed 1,212 tests and skipped two tests.
Fresh independent review found no remaining issues within the reviewed startup scope.
These local checks do not establish Renderer loading, full module compatibility, signed replacement parity, deployment, or device acceptance.

## Signed Renderer startup verification

The [native startup contract](NATIVE_PLUGINS.md#renderer-startup) now includes selected Renderer surface revisions.
The shared loader verifies publisher policy, trust, exact grants, and signed bytes before publishing asset routes.
The protocol serves captured browser code, CSS, relative assets, and JSON without rereading stored files.
Discovery uses the existing Shell main-frame authorization channel.
Installed HTML connection restrictions remain unchanged.

The initial Renderer tests failed because the asset module was absent.
Independent review found that Shell CSP blocked signed JSON fetches.
A failing CSP regression preceded the restricted protocol connection rule.
The actual Electron failure fixture also found sanitized cross-origin script errors accepting failed entries.
Anonymous cross-origin error reporting repaired default recovery.
The fixture now waits for `odkShellReady` instead of treating diagnosis startup as composition completion.

Three hidden Electron fixtures passed signed startup, failure after registration, and corruption before discovery.
The independent Clock factory preserves one display-only Clock and its scoped time reading.
The signed fixture verifies code and CSS after stored mutation, relative CSS imports, JSON fetching, and lifecycle cleanup.
The local Widget/App style checks and Pixel density checks also passed in isolated profiles.
The density checks covered five viewport sizes without violations.
The focused Renderer, native, Main wiring, and package lifecycle checks passed 63 tests.
The complete Shell suite passed 1,219 tests and skipped two tests.
Fresh independent review found no remaining issues in the reviewed Renderer startup scope.

The complete E2E command was not run because its child fixtures include window focus and nonisolated profile behavior.
The Widget skill requires isolation and prohibits focus stealing.
The later isolated interaction verification below supersedes this harness limitation.
These checks do not establish Appearance native loading, complete signed replacement parity, CM5, Windows, physical input, or assistive-technology acceptance.

## Signed Appearance startup verification

The [Appearance startup contract](NATIVE_PLUGINS.md#appearance-startup) now includes captured signed factories and palette-only declarations.
Factory declarations and actual ports retain the complete packaged theme context.
Palette-only selections keep their separate data validation path without browser entry execution.
The loader checks declarations before entry execution and actual definitions before factory execution.
Shell readiness waits for Appearance startup, while synchronous preview preserves first-paint selection.
Page shutdown cancels pending loading and prevents late factory activation.

Initial tests rejected signed factory declarations because the store accepted only palette data.
Regression checks now cover signed discovery, captured code, disabled selections, caught duplicate definitions, invalid context, and shutdown during discovery.
Fresh independent review found no material issues in the reviewed startup scope and passed 35 focused tests.
Three hidden Electron fixtures passed signed startup, failure after definition, and invalid factory ports.
Stored entry mutation after discovery did not change the executed captured code.
Invalid entries restored packaged factories; invalid ports released resources and retained independent theme fallback.
Saved Pixel preferences survived both failure modes.
The successful fixture compared Clock font, size, geometry, radius, and primary color across all three packaged themes.
Those measurements matched the packaged baseline after signed selection removal.
The signed Renderer startup fixture also passed after the shared script loader and readiness changes.
The complete Shell suite passed 1,225 tests and skipped two tests.
Two old VM fixtures initially lacked the browser AbortController API; their environment now supplies that API without changing assertions.
The isolated Widget/App style fixture passed.
The isolated Pixel density fixture covered five viewport sizes with no violations.

The fixtures used isolated temporary profiles, hidden windows, and injected source channels without live capture.
These checks do not establish installed-package interaction, arbitrary theme replacement parity, CM5, Windows, physical input, or assistive-technology acceptance.

## Isolated complete interaction verification

The E2E launcher now supplies a temporary profile before each child fixture loads.
The launcher removes its profile after normal completion, nonzero exit, timeout, or spawn failure.
The parent also removes its own profile on immediate process exit.
Existing fixtures can create secondary temporary profiles; external kills can prevent their own cleanup.
No fixture in this gate requests desktop window focus.

Page Indicator and Pixel Font checks use [Chromium focus emulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setFocusEmulationEnabled).
Page Indicator dispatches browser keyboard events and retains Tab, Enter, Space, and visible-focus assertions.
Real hidden Electron checks passed both fixtures without window activation.
The complete gate retains all composition, motion, geometry, density, theme, voice, and installed desktop subchecks.
Voice checks inject state and control responses without live microphone capture.

Initial isolation regressions failed for direct child spawning and desktop focus requests.
Discovery regressions failed for missing plugin discovery handlers.
An execution-level fixture regression caught duplicate handler registration after a mock edit; the loop body is repaired.
Each affected fixture now supplies empty plugin discovery and explicit unavailable source states where required.
These responses replace missing-handler fallbacks without changing product code or failure assertions.

A repeated interaction run found retained wide Widget spans after a compact resize.
The observer could decide placement before the Shell animation frame published new grid metrics.
A failing regression captured resize without an observer callback.
The Shell now applies grid placement after geometry in the same resize frame, before pager refresh.
The focused compositor, runtime, Shell, and isolation checks passed 27 tests.
The final complete Shell suite passed 1,232 tests and skipped two tests.
The final complete E2E command passed driver, motion, geometry, three composition subchecks, six density matrices, and seven theme subchecks.
The final E2E log contained no missing IPC handlers or failed assertions.
Independent review found no remaining actionable findings in the isolation, mock, and resize-order changes.

One simultaneous unit and E2E run failed an Electron verifier operation under load.
The final unit and E2E gates ran sequentially and completed successfully without timeout changes.
These results do not certify concurrent gate execution under that load.

These local checks do not establish signed replacement parity for every feature, CM5, Windows, physical input, or assistive-technology acceptance.

## Signed Futu service replacement verification

Cleanup retry regressions reproduced lost endpoint ownership in both default and signed service selections on 2026-10-10.
The Futu source now removes its listener reference only after successful stop.
The service socket retains its channel after close failure; concurrent stop calls await the same active close operation.
The failure check injects one endpoint withdrawal error through the real Unix channel and Plugin Host.
It preserves failed cleanup, retained catalog ownership, startup refusal, successful retry, and later publisher readings.
Three regressions failed before repair: two endpoint retry checks and one concurrent close check.
The affected source, socket, service, health, diagnosis, isolation, refresh, and channel command passed 73 checks and skipped one Windows-only check.
A separate endpoint, diagnosis, Widget, smoke, and production Main command passed 31 checks without failures or skips.
Both commands used strict unhandled rejection handling and completed in 16991 and 43447 milliseconds respectively.
Independent review passed thirteen focused checks and reported no new findings within the repaired lifecycle paths.
The latest complete Shell command includes this repair; the scope section owns its result and input integrity.
Windows, CM5, and live gateway behavior remain unverified after this repair.

These checks completed on 2026-10-09.
The [shared acceptance checks](../tests/futu-service-replacement.test.js) compare the default `odk.service.futu` factory with an independent signed factory.
The [fixture factory](../tests/fixtures/futu-service-replacement/entry.cjs) does not call the packaged service factory.
It uses the injected Futu source capability and copies current projection libraries into the temporary signed bundle.
The actual Native CLI installs that bundle with independent publisher policy, trust, and exact grants.
The native loader supplies the replacement to the actual Main composition and Plugin Host.

Both implementations receive real records through a temporary Unix publisher channel.
Checks cover service identity, labels, timestamps, percentage scaling, live values, authentication requirements, provider failure, and stale data.
Health excludes holdings, private errors, and authentication details.
Disable removes IPC handlers, withdraws Open DeskOS Data readings, and closes the listener before enable creates a new source.
Catalog removal closes its listener and withdraws service readings.
Late catalog completion after disable cannot reopen a listener.
Corrupt and removed selections feed the actual fallback composition, whose default factory receives publisher records and restores consumer values.

The loader captures the factory and projection module before execution.
Mutation of both stored files after discovery cannot alter the selected execution.
Initial acceptance failed because the independent fixture was absent; the completed signed fixture passes the shared contract.

The [hidden Electron fixture](../tests/futu-service-electron.cjs) connects those service implementations to the actual preload and Futu Widget.
It compares displayed ratios, holding rows, accessible names, display-only role, font settings, and tile geometry across three themes.
It also checks stale markings, empty holdings, authentication guidance, and unavailable values.
The [timeout check](../tests/futu-service-isolation.test.js) triggers failure after the signed factory connects a publisher.
It verifies removal of the socket, signed revision directory, temporary root, and browser profile.
The fixture sets isolated user and session directories before Electron readiness.
No test uses production profiles, SDK accounts, gateways, camera capture, or microphone capture.
Eight focused checks passed, including the actual Electron timeout cleanup path.
The hidden Electron comparison passed all three packaged themes.
The final complete Shell suite passed 1,240 tests and skipped two tests.
Fresh independent review found no outstanding material findings after the harness and fallback corrections.

These checks reuse existing source and projection libraries.
They do not establish an alternative publisher implementation, independent projection algorithm, pixel equivalence, live gateway behavior, Windows, or CM5 acceptance.

## Native Futu service and Widget acceptance

The existing Futu service, isolation, and hidden Electron checks ran on CM5 and macOS with private host paths.
Both hosts passed all twelve service and cleanup checks without failures or skips.
The service test durations were 3698 milliseconds on CM5 and 1184 milliseconds on macOS.
The separate positive Electron comparison passed in 13484 milliseconds on CM5 and 2702 milliseconds on macOS.
Both commands retained all 673 captured source, test, script, and package inputs unchanged.
No task-owned acceptance process remained on CM5 after completion.

Default and signed service factories preserve publisher states, IPC values, Open DeskOS Data percentages, catalog changes, and listener release before restart.
Failed endpoint withdrawal retains cleanup ownership until retry succeeds.
Late catalog completion after disable cannot reopen the listener.
Corrupt and removed selections restore the default composition.
The negative Electron scenario removes its private profile, signed store, temporary root, and connected publisher after the controlled timeout.

The positive comparison uses actual preload and the Futu Widget with a temporary Unix publisher.
Three themes preserve displayed ratios, holding rows, accessible names, display-only role, font settings, and tile geometry.
The fixture also preserves stale markings, empty holdings, authentication guidance, and unavailable values.
The selected factory and projection execute captured bytes after stored file mutation.
The comparison retains shared source and projection libraries; it does not establish another publisher or projection algorithm.

Run these commands from `runtime/shell/` with private host paths:

```sh
node --test --test-concurrency=1 tests/futu-service-replacement.test.js tests/futu-service-isolation.test.js tests/futu-service-isolation-wiring.test.js
pnpm exec electron tests/futu-service-electron.cjs
```

CM5 emitted GL driver and D-Bus warnings while completing both phases successfully.
These results do not establish hardware acceleration, raster equivalence, complete density coverage, live gateway behavior, or physical interaction.
The fixture controls unrelated Renderer readings and does not start complete production Main.
Windows service and Widget execution remain separate from the earlier Python pipe checks.
No product source, fixture deadline, production service, or active release changed.

## Signed App Manager replacement verification

These checks completed on 2026-10-09.
The [shared checks](../tests/app-manager-replacement.test.js) compare the default App Manager with an independent signed factory.
The [factory](../tests/fixtures/app-manager-replacement/entry.cjs) constructs its manager from a captured module inside the signed bundle.
It does not call the packaged system plugin factory or the injected default manager factory.
The bundle copies the current endpoint library; these checks do not establish an independently authored state machine.

The actual Native CLI installs the bundle with external publisher policy, explicit trust, and exact grants.
The native loader supplies the selected factory to the actual Main composition and Plugin Host.
Stored entry and manager mutations after discovery cannot change captured execution.
Both implementations preserve App metadata, catalog copies, foreground ownership, intent errors, traces, transition records, and rollback guards.
Disable removes all three IPC handlers and withdraws the manager port.
Enable constructs a fresh manager with the existing default initial states.
Corrupt or removed selections start the default composition and preserve stored revisions.

The [hidden Electron fixture](../tests/app-manager-electron.cjs) uses the actual preload, App platform, registry, and Shell UI.
It compares App switching, Back, Escape, catalog search, and foreground recovery after a failed lifecycle mount.
The fixture waits for asynchronous catalog content before it checks search results.
Temporary user and session directories precede Electron readiness; the window stays hidden.
External source channels use fixtures without production services or live capture.
The fixture disables unrelated Main plugins and does not certify complete production startup.

The focused Node command passed 62 checks.
The hidden Electron comparison completed without assertion failures.
The complete Shell suite passed 1,243 checks and skipped two checks.
Fresh independent review found no material findings in the signed factory, shared checks, or inspected Electron fixture.
The reviewer ran the three replacement checks without failures.
These results do not establish another state-machine algorithm, production deployment, native Windows, CM5, or physical input acceptance.

## Signed Open DeskOS Data replacement verification

These checks completed on 2026-10-09.
The [shared checks](../tests/odk-data-replacement.test.js) compare default Open DeskOS Data with a signed bundled factory.
The [factory](../tests/fixtures/odk-data-replacement/entry.cjs) constructs its registry from captured modules inside the signed bundle.
It does not call the packaged system plugin factory or the injected default Open DeskOS Data factory.
The bundle copies current registry, control, transport, and projection libraries.
These checks establish factory and registry ownership without an independently authored registry algorithm.

The actual Native CLI installs the bundle with external publisher policy, explicit trust, and exact grants.
The native loader supplies the factory to the actual Main composition and Plugin Host.
Mutating stored factory and registry files after discovery cannot change captured execution.
The composition includes separate source and service reading extensions with declared optional ports.

Both implementations preserve the six-reading fixture inventory and Weather metadata, timestamps, values, and four availability states.
Source and service extensions withdraw their readings on disable and restore them on enable.
Source dependency restarts preserve unchanged package publications and their untrusted flag.
Changed package revisions invalidate previous publications; failed catalog reads preserve existing publications.
Catalog removal withdraws package readings.
Cancelled catalog work cannot restore removed readings after the registry restarts.
Corrupt or removed native selections restore actual default consumers and preserve stored revisions.

The real Unix Open DeskOS Data Link serves both implementations through the existing read-only protocol.
The actual Personal Bot client lists readings and reads Weather and published package values through that listener.
Package values and timestamps survive a Open DeskOS Data disable and enable cycle.
The channel rejects mutation commands and removes its socket when the Open DeskOS Data dependency stops.
All channels, configuration, and signed revisions use temporary local directories without production services or live capture.

Seven replacement checks passed, including three signed factory checks and default fallback.
The existing Personal Bot Open DeskOS Data command passed ten checks.
The complete Shell suite passed 1,250 checks and skipped two checks.
Fresh independent review reran all seven replacement checks without material findings.
These results use selected synthetic providers and do not establish all source implementations or full Electron startup.
Native Windows channels, CM5, production deployment, and physical-device acceptance remain unverified.

The synchronization checks were updated on 2026-10-10.
Only the latest started catalog synchronization can reconcile package readings within one Open DeskOS Data instance.
Six regressions failed before the repair; the repair adds one local generation counter without changing public interfaces.
Both factories reject superseded results after removal, revision changes, unreadable responses, and malformed responses.
The checks cover both completion orders and actual Personal Bot reads through the Unix listener.
The wiring check now requires one selected catalog instead of two stores and confirms the service endpoint remains available.
The affected command passed 100 checks with zero failures and zero skips.
A fresh independent review repeated 39 replacement and wiring checks with no actionable findings.
The Personal Bot client command also passed all ten checks.

```sh
node --test --test-concurrency=1 tests/odk-data-replacement.test.js tests/odk-data.test.js tests/odk-data-shell.test.js tests/odk-data-wiring.test.js tests/desk-runtime-plugins.test.js tests/user-app-system-replacement.test.js tests/user-app-pending-operations.test.js
```

Run `node --test tests/odk-data.test.mjs` from `integrations/personal-bot/` for the client checks.

## Installed runtime cleanup retry verification

These checks completed on 2026-10-09.
The [runtime](../src/user-app-system.js) retains failed IPC removals, protocol removals, and listener closes until cleanup succeeds.
Successful callbacks leave the retained set and do not run again during retry.
Concurrent cleanup callers wait for the same release operation.
Shutdown waits for pending listener startup and retains a late listener if its close fails.
Cancelled startup propagates cleanup failure instead of discarding the listener reference.

The [regression checks](../tests/user-app-lifecycle.test.js) reproduced lost listener ownership, lost protocol retry, early concurrent completion, and swallowed late close failure.
The actual Plugin Host now retains the Open DeskOS Data dependency after installed runtime cleanup fails.
Restart refuses retained resources until another shutdown attempt succeeds.
The checks also inject IPC removal failure and confirm that successful handlers release only once.
The [runtime scenarios](../tests/features/user-app-runtime.feature) define these ownership and retry requirements.
Package protocols, installation records, permissions, and document contracts remain unchanged.

The focused lifecycle, Desk runtime, and Main wiring command passed 35 checks.
The complete Shell suite passed 1,255 checks and skipped two checks.
Fresh independent review found no material findings in the cleanup and cancellation changes.
These checks use mocked Electron APIs and controlled listeners without production services or live capture.
They do not establish independent installed-runtime factory replacement, real Electron failure injection, Windows, CM5, or physical-device acceptance.

## Native installed catalog and runtime acceptance

The existing catalog, installed runtime, verifier, control, protocol, and lifecycle checks ran on CM5 and macOS with private host paths.
Both hosts passed all 90 checks without failures or skips.
The test durations were 20658 milliseconds on CM5 and 22352 milliseconds on macOS.
The separate installed runtime Electron comparison passed in 7961 milliseconds on CM5 and 2331 milliseconds on macOS.
Both commands retained all 673 captured source, test, script, and package inputs unchanged.
No task-owned acceptance process remained on CM5 after completion.

Default and signed runtimes preserve import, placement, occupied placement refusal, update, rollback, revision content, and removal without changing draft files.
Verification refusal retains the active revision and exact catalog bytes.
Selected catalog methods drive IPC, content, and Unix control without constructing another default catalog.
Cleanup checks retain pending verification, synchronization, content, listeners, and dependencies until their operations settle or cleanup retry succeeds.
Stopped callbacks cannot admit more work.

Separate actual Electron verifier cases accept maximum-sized visible content, run concurrent private profiles, reject script failure, and stop infinite execution by deadline.
They also preserve network and navigation confinement, process closure, and profile cleanup.
The runtime comparison seeds verified fixture revisions with a controlled verifier.
It does not repeat installation through that actual verifier.

The hidden Electron comparison uses actual preload, protocol, opaque package frames, and three themes.
It verifies loaded Zpix, parent access refusal, absent package preload, and distinct package-origin data publication before direct preload publication.
Catalog disable removes runtime IPC and content routes; recovery restores the package list and published value.
Runtime disable and enable preserve package availability.
The selected factory executes captured runtime bytes after stored file mutation.
This alternative owns its bundled factory and retains shared runtime modules.

Run these commands from `runtime/shell/` with private host paths:

```sh
node --test --test-concurrency=1 tests/desk-runtime-plugins.test.js tests/user-app-system-replacement.test.js tests/user-app-pending-operations.test.js tests/user-app-lifecycle.test.js tests/user-app-runtime.test.js tests/user-app-verifier-lifecycle.test.js tests/user-app-store.test.js tests/user-app-control.test.js tests/user-app-protocol.test.js
pnpm exec electron tests/user-app-system-electron.cjs
```

Both Electron logs include the expected missing-handler errors while the catalog is disabled.
CM5 also emitted GL driver and D-Bus warnings while completing successfully.
These checks do not establish complete Main integration, all package interactions, physical interaction, raster equivalence, or Windows acceptance.
No product source, fixture deadline, production service, or active release changed.

## Signed installed runtime replacement verification

Widget import and placement checks completed on 2026-10-10 through the existing default and signed runtime fixture.
Local control imports the Widget; IPC moves it, and list, desktop, and content consumers retain the accepted revision.
Occupied placement refusal preserves exact catalog bytes; runtime restart retains placement, and removal preserves the source package.
The affected command passed 52 tests with zero failures or skips in 2638 milliseconds.
It used strict unhandled rejection handling and ran the replacement, placement, control, store, and desk runtime suites.
The initial failure was a cross-context test comparison; public JSON comparison corrected it without production changes.
These checks do not establish complete package interaction, graphical composition, or supported-host acceptance.

These checks completed on 2026-10-09.
The [shared checks](../tests/user-app-system-replacement.test.js) compare default and signed installed Widget/App runtime factories.
The [signed factory](../tests/fixtures/user-app-system-replacement/entry.cjs) starts captured modules from its own bundle.
It does not call the injected default runtime starter.
The bundle copies current runtime modules, document libraries, and font files.
These checks prove factory ownership without an independently authored runtime implementation.

Initial synchronization rejection reproduced an unhandled Promise in the signed fixture on 2026-10-10; the default implementation passed.
The fixture now retains that synchronization through cleanup and handles its rejection, matching the existing default lifecycle contract.
Shared pending-operation scenarios exercise the actual alternative entry with controlled runtime dependencies for both synchronization success and rejection.
Independent review also observed default and actual signed execution with pending synchronization; shutdown retained both data and catalog providers until settlement.
The reviewer reported no new findings and passed twelve pending-operation checks.
The final affected command passed 75 tests with zero failures or skips in 3298 milliseconds under strict unhandled rejection handling.
It covered replacement, pending operations, lifecycle, desk runtime, placement, control, and store checks from `runtime/shell/`.

The default runtime now consumes the selected package catalog instead of constructing a second default store.
The default catalog owns verification; runtime cleanup waits for its retained verification resources without closing catalog admission.
Standalone runtime callers retain their existing fallback store and verifier lifecycle.
Three regressions reproduced catalog bypass and missing verification ownership; two further regressions reproduced lost child waiting and missing reusable drain.
A minimal alternative catalog now drives actual runtime IPC, document responses, Unix control, and Open DeskOS Data publications.
Its removals withdraw content and readings without modifying the unused default store.
Real store checks preserve verification rejection, failed cleanup retry, and cleanup after catalog construction failure.
Independent review repeated the updated lifecycle and verification checks without further actionable findings.
The catalog repair command passed 125 checks with zero failures or skips in 36096 milliseconds on 2026-10-10.
It covered store, runtime, verifier, control, protocol, Open DeskOS Data, Main startup, App Manager, Appearance, and installed desktop consumers.
Actual Electron checks included verification, source confinement, and installed desktop composition.
The command ran from `runtime/shell/` and completed with exit status zero.

```sh
node --test --test-concurrency=1 tests/desk-runtime-plugins.test.js tests/user-app-lifecycle.test.js tests/user-app-pending-operations.test.js tests/user-app-system-replacement.test.js tests/user-app-runtime.test.js tests/user-app-verifier-lifecycle.test.js tests/user-app-store.test.js tests/user-app-control.test.js tests/user-app-protocol.test.js tests/main-smoke.test.js tests/main-plugin-replacement.test.js tests/odk-data-replacement.test.js tests/app-manager-main-bootstrap.test.js tests/appearance-main-bootstrap.test.js tests/user-app-desktop-plugins-electron.test.js
```

The catalog availability repair followed the preceding 2026-test Shell run on 2026-10-10.
The latest 2031-test Shell run includes this repair.
The installed runtime now requires its selected catalog instead of restarting with a null store when that provider becomes unavailable.
Three regressions first failed for disabled catalog startup, failed catalog startup, and signed runtime catalog bypass.
Both default and signed runtime checks now preserve catalog selection, installed revisions, publications, and cleanup across catalog disable and recovery.
No fallback store or verifier is constructed through this plugin path; standalone callers retain their existing behavior.
The affected command passed 113 checks with zero failures or skips in 9214 milliseconds.
A fresh independent review repeated 42 focused checks and reported no actionable findings.

```sh
node --test --test-concurrency=1 tests/desk-runtime-plugins.test.js tests/user-app-system-replacement.test.js tests/user-app-lifecycle.test.js tests/user-app-pending-operations.test.js tests/odk-data-wiring.test.js tests/main-smoke.test.js tests/main-plugin-replacement.test.js tests/config-inventory.test.js tests/user-app-control.test.js tests/user-app-store.test.js tests/user-app-runtime.test.js
```


The actual Native CLI installs the temporary bundle with publisher policy, explicit trust, and exact grants.
The loader selects the factory through the actual Main composition and Plugin Host.
Changes to stored entry and runtime files after discovery cannot change captured execution.
Both factories preserve package metadata, document bytes, CSP, three themes, and the three packaged font files.
Declared package values retain their untrusted flag across disable and enable operations.
Undeclared publication fields fail, and package removal withdraws documents and readings.
The actual Unix control listener reports the same installed revision before and after restart.

Shared revision operation checks ran on 2026-10-10 through runtime IPC and the actual local control listener.
Both default and signed selected runtimes preserve update, rollback, active document content, and rollback history after runtime restart.
Verification rejection preserves the active revision and exact persisted catalog bytes through both command consumers.
Draft content remains unchanged by rollback.
The affected command passed 48 tests with zero failures or skips in 2202 milliseconds.
The verifier verdict is controlled; these checks do not establish graphical verification or installed App interaction.
No production source changed.

```sh
node --test --test-concurrency=1 tests/user-app-system-replacement.test.js tests/user-app-control.test.js tests/user-app-store.test.js tests/desk-runtime-plugins.test.js tests/user-app-lifecycle.test.js
```

Injected protocol removal failure retains the route and blocks the Open DeskOS Data dependency and runtime restart.
A second shutdown releases the route, and restart restores the control listener.
The Open DeskOS Data fixture has no cleanup callback; its blocked state does not prove retention of actual provider resources.
These cases do not inject failures into actual Electron protocol removal or listener close operations.

The [hidden Electron fixture](../tests/user-app-system-electron.cjs) uses actual preload, IPC, protocol, and opaque package frames.
It compares package content, theme selection, loaded Zpix, parent access refusal, and absent preload access across three themes.
The package publishes a distinct value through its frame bridge before any direct preload publication.
The fixture observes that value in Open DeskOS Data before disposing the frame.
Disable and enable operations restore the actual preload package list.
The catalog recovery rerun completed with exit status zero on 2026-10-10.
Both factories released IPC and document routes when the catalog was disabled.
Recovery restored the actual preload package list and the published value.
Its report included `catalogRecovery: true`.
Its temporary profile sets both Electron user and session directories before startup.

The manual Electron command runs from `runtime/shell/`:

```sh
env -u ELECTRON_RUN_AS_NODE TMPDIR=/tmp corepack pnpm@11.22.0 exec electron tests/user-app-system-electron.cjs
```

Four shared replacement checks and the focused 51-check command passed.
The complete Shell suite passed 1,259 checks and skipped two checks.
An earlier full run failed the actual Electron verifier during a CLI update.
The isolated CLI command passed ten checks, and the full rerun passed without verifier changes or longer timeouts.
These reruns do not establish the cause of the earlier failure.
The hidden Electron command passed separately; the Node suite does not run this command.
Fresh independent review found no material issues after checking frame publication and cleanup retry assertions.
Package revisions use a fixture verifier; these checks do not prove actual package verification, update, or rollback.
The fixture disables unrelated Main plugins and does not certify complete Shell startup or App navigation.
Windows, CM5, deployment, physical input, and assistive technology remain unverified.

## Independent Quota implementation verification

These checks completed on 2026-10-09.
The [replacement entry](../tests/fixtures/quota-replacement/entry.cjs) now implements request ownership and reading projection without Shell module imports.
Its cancellation implementation counts active reads and resolves shutdown waiters when every read settles.
The [public contract](QUOTA_PLUGIN_CONTRACT.md) defines declarations, capabilities, IPC, projection, and resource ownership.

The import refusal check failed before the independent implementation replaced the shared libraries.
The [shared checks](../tests/quota-plugin-parity.test.js) exercise default, linked, and signed implementations through actual Main composition and Open DeskOS Data.
They preserve complete IPC responses, restricted reading fields, home metadata, exact percentages, null values, and omitted measurements.
Concurrent success and failure responses cannot publish live data after cancellation.
Same-turn cancellation prevents provider entry, and shutdown waits for every pending read.
Existing cases retain provider rejection, cleanup failure retry, dependency withdrawal, restart, and development-link removal.

The signed path uses the actual Native CLI, publisher policy, explicit trust, exact grants, and native loader.
Changing the stored entry after discovery does not change captured execution.
The example uses the existing provider capability; it does not implement another account provider or network transport.
Fresh independent review found no material lifecycle or projection differences.
The reviewer reran all 20 shared checks without failures.
The focused source, plugin, service-reading, and Open DeskOS Data command passed 56 checks.
The complete Shell suite passed 1,272 checks and skipped two checks.
Rendered interaction, deployed hosts, Windows devices, and CM5 remain unverified by these checks.

## Signed Quota revision operation verification

These checks completed on 2026-10-09.
The [revision case](../tests/quota-plugin-parity.test.js) uses actual Native CLI update, rollback, and removal commands.
Its temporary signed bundles contain the independent Quota implementation and a revision-specific, non-enumerable test marker.
The marker identifies executed entry bytes separately from selected manifest versions.

Updating the stored selection leaves the running source instance unchanged.
A complete in-process Host shutdown and new composition load the updated factory.
Both revisions preserve actual IPC responses and Open DeskOS Data projection values.
An unsigned entry update fails with a file hash mismatch and preserves configuration bytes and the running source.
Rollback retains the running source until restart and then executes the previous revision.
Removal restores the actual default factory after restart without deleting retained signed revision bytes.
The native store verifies both retained revisions after removal.
The restart fixture refuses retained cleanup failures before creating another Host.

The final Quota and native CLI, manager, and loader command passed 50 checks.
The complete Shell suite passed 1,273 checks and skipped two checks.
Fresh independent review confirmed the executed-revision marker and specific unsigned-update rejection without material findings.

These checks use synthetic provider responses, temporary policy, temporary configuration, and temporary revision storage.
They do not establish an Electron process restart, runtime hot replacement, rendered interaction, deployment, Windows devices, or CM5 acceptance.

## Quota Electron consumer verification

These checks completed on 2026-10-09.
The [Electron check](../tests/quota-electron.test.js) compares default and signed independent Quota implementations through the existing Shell page.
The [shared runtime fixture](../tests/helpers/quota-runtime.js) loads actual Main composition, source ports, Open DeskOS Data, and IPC handlers.
The signed factory uses temporary Native CLI installation, publisher policy, trust, exact grants, and captured entry bytes.
The renderer uses the actual preload, subscription service, Quota page, and theme declarations.
Other source channels return explicit synthetic fixtures.

The matrix covers Instrument, Pixel, and Border Beam at 1920 by 1280 and 480 by 854.
Both implementations preserve account text, fractional accessible meter values, unknown windows, partial errors, and checked status.
A held provider response verifies the disabled refresh control and busy feedback before completion.
Refresh checks cover retained data, unauthorized access, unconfigured service, empty accounts, provider rejection, and recovery.
Account content must not overflow horizontally.
Meters must remain inside their account and viewport.
The refresh control must remain inside the visible page and viewport with readable text.
The check requests the three packaged fonts and verifies expected numeral font families and a loaded Zpix face.
DOM click navigation must reach Today before a synthetic End key event returns to Usage.

The parent owns the temporary profile and removes it after success, failure, or child termination.
The child sets both Electron user and session directories before readiness and never shows its window.
Cleanup destroys the window and drains owned Host resources before exit.
Fresh independent review checked viewport, font, intermediate navigation, IPC, and isolation assertions without remaining material findings.
The focused Electron and shared parity command passed 22 checks.
The complete Shell suite passed 1,274 checks and skipped two checks.
The Electron consumer check runs automatically within that Node suite.

These checks do not establish pointer hit testing, physical input, screen-reader operation, live account providers, deployed hosts, or CM5 acceptance.
They do not execute complete production Main startup or certify every Shell surface.

## Independent Pi Session Events implementation verification

These checks completed on 2026-10-09.
Main now supplies the existing local event reader alongside the default constructor in the granted `source.pi-events` capability.
The additive operation preserves the default construction path and existing IPC permissions.
The [replacement entry](../tests/fixtures/pi-events-replacement/entry.cjs) implements its callable source without Shell imports or default constructor calls.
The [public contract](PI_EVENTS_PLUGIN_CONTRACT.md) owns declared ports, request normalization, fallback reasons, and cancellation behavior.

The initial construction and Main wiring checks failed before the capability and independent implementation were added.
The [shared checks](../tests/pi-plugin-parity.test.js) compare default and independently linked event factories through actual Main composition and IPC handlers.
Reported success and authoritative failure preserve complete responses without local fallback.
Only the three existing unavailable reasons permit local log inspection.
Active reported and local errors retain their existing rejection behavior.
Cancellation drains every parallel reported read and already active local read before restart.
Late success and rejection cannot restore available results or start additional local work.
Pre-aborted independent construction starts no reported request.

Both implementations use the actual local parser with a temporary JSONL log and explicit temporary agent directory.
The checks preserve five event kinds, failed tool-call identity, multiline output, and English and Chinese assistant text.
Authoritative reported failure avoids that local log, and log removal returns the existing missing-log result.
The Main capability wiring check reads source text; it does not execute Electron startup.
Fresh independent review found no material lifecycle, capability, parser, or contract issues.
The focused source, composition, replacement, and local parser command passed 73 checks.
The complete Shell suite passed 1,285 checks and skipped two checks.

Pi Sessions used its existing source implementation in the replacement fixture for these earlier checks.
These earlier results do not establish signed Events distribution, rendered transcripts, live Open DeskOS Link, deployed hosts, or physical-device acceptance.
Replacement cancellation during promise settlement is not exhaustively tested.

## Signed independent Pi Session Events verification

These checks completed on 2026-10-09.
The [shared checks](../tests/pi-plugin-parity.test.js) now exercise default, linked, and signed independent event implementations.
The [installation helper](../tests/helpers/pi-events-selection.js) uses the actual Native CLI with temporary configuration and revision storage.
Its generated Ed25519 publisher policy permits only the Pi Events identity on `electron-main`.
Installation supplies explicit trust and exact `source.pi-events` and `ipc` grants.
Pi Sessions retains its default implementation in signed event cases.

Each signed case changes stored entry bytes after discovery and still executes the captured independent factory.
The shared checks reject calls to the default event constructor.
They preserve reported results, authoritative failures, request normalization, local fallback, active errors, and cancellation drain behavior.
Actual temporary JSONL logs verify the existing parser, multiline output, event identity, and English and Chinese text.
Corruption before discovery reports a native file hash mismatch and restores actual default event and session consumers.
Removing the stored selection restores the default event consumer and preserves the corrupted entry bytes.
This retention check does not verify retained bundle integrity or every stored file.

The initial signed-selection assertion failed before native installation was added.
The focused parity, source lifecycle, native loader, and Native CLI command passed 67 checks.
Fresh independent review found no material issues and independently passed all 35 parity checks.
The complete Shell suite passed 1,296 checks and skipped two checks.
Main capability wiring remains a source assertion; the composition checks do not start production Electron Main.
Signed Events update and rollback, rendered transcripts, live Open DeskOS Link, deployed hosts, Windows, CM5, and physical input remain unverified.

## Independent Pi Sessions implementation verification

These checks completed on 2026-10-09.
Main now supplies configured session inspection alongside the existing default constructor in the granted `source.pi-sessions` capability.
The [configured reader](../src/pi-sessions-source.js) retains local and SSH collection without Open DeskOS Link selection, aggregation, or reading projection.
The default factory uses this extracted operation without changing its source selection or lifecycle contracts.
The [independent entry](../tests/fixtures/pi-sessions-replacement/entry.cjs) owns aggregation, projection, and request lifetime without Shell imports or default constructor calls.
The [public contract](PI_SESSIONS_PLUGIN_CONTRACT.md) owns its capability, source selection, identity precedence, projection, IPC, and shutdown behavior.

| Requirement | Current evidence | Remaining evidence |
| --- | --- | --- |
| Independent factory | Import refusal, default constructor poison, active or pre-aborted construction, and subsequent signed revision acceptance | Electron process restart and deployed revision changes |
| Source selection | Shared local and injected SSH reads, reported precedence, and authoritative Hosted Pi collision | Live alternative collector and transports |
| Aggregation | Identity order, activity ties, observation times, anonymous sessions, workspace groups, and rebuilt counts | Rendered session navigation |
| Reading projection | Actual Open DeskOS Data consumers, 20-session bound, 160-character text bound, nulls, omissions, and unknown status counts | Real agent reading consumer |
| Request ownership | Shared coalescing, provider reentry, synchronous rejection, retained parallel reads, and local or SSH cancellation drain | Physical host execution |
| Main integration | Capability source assertion and actual Main composition with selected factories | Production Electron Main startup |

The initial independent construction, capability, and default-constructor checks failed before implementation.
Additional shared checks reproduced provider reentry and synchronous failure differences in the first independent implementation.
The corrected entry preserves one active promise before invoking providers and retains synchronous rejection while active.
Local cancellation waits for the started read and suppresses late rejection.
The injected SSH child reports abort before close; replacement shutdown waits for close before restart.
The final focused composition, parity, source, lifecycle, replacement, and reading command passed 118 checks.
Fresh independent review found no material issues and independently passed all 68 shared parity checks.
The complete Shell suite passed 1,329 checks and skipped two checks.

The event-only signed checks in this section retain default Pi Sessions; subsequent paired checks exercise both signed independent sources.
SSH parity uses injected child responses and does not connect to configured hosts.
These checks do not certify alternative collectors, rendered interaction, deployed hosts, Windows, CM5, or physical input.

## Signed independent Pi Sessions and Events verification

These checks completed on 2026-10-09.
The [shared matrix](../tests/pi-plugin-parity.test.js) now runs with both signed independent factories alongside default, linked, and event-only signed selections.
The [installation helper](../tests/helpers/pi-events-selection.js) uses the actual Native CLI and temporary revision storage for both identities.
Publisher policy permits only these two identities on `electron-main`.
Each installation supplies explicit trust and its exact source and IPC grants.

Both factories retain captured execution after their stored entry bytes change after discovery.
The matrix refuses default constructor calls for each selected replacement.
Actual Main composition and consumer IPC preserve source selection, Hosted Pi identity precedence, workspace summaries, reading projection, event fallback, and parser behavior.
Shared lifecycle cases retain coalescing, provider reentry, synchronous rejection, parallel ownership, local drain, and SSH close drain.
The SSH responses and child close events remain injected.

Two separate cases corrupt one stored entry before the next discovery.
Each reports one explicit native hash mismatch and restores only that identity's default factory.
The other signed factory remains selected and serves actual session, event, and Open DeskOS Data consumers.
Current captured instances still serve those consumers before shutdown, despite the stored corruption.
Native removal changes only stored selections; subsequent composition restores both defaults.
All three files of both fixture revisions retain their exact bytes after removal.
The valid retained peer still passes native store verification, while the corrupted retained revision still fails verification.
File retention does not repair corruption or establish integrity of the corrupted revision.

The initial paired case failed because Pi Sessions had no native selection.
The final parity, source, lifecycle, native loader, and Native CLI command passed 147 checks.
Fresh independent review found no material issues and independently passed all 90 parity checks.
An initial complete Shell run passed 1,349 checks, failed two checks, and skipped two checks.
The failures concerned Futu timeout cleanup and real Electron verification during HTML installation.
Running those two files together reproduced both failures.
Each failing case passed when run separately without implementation changes or increased timeouts.
These isolated passes do not establish the cause of the earlier failures.
A complete rerun reproduced the same two failing cases.
The HTML case failed during rollback verification on the rerun, rather than initial installation.
The complete Shell gate remains failed despite the passing Pi and native acceptance command.

These earlier checks do not establish signed Pi update or rollback, production Electron Main startup, rendered transcripts, or alternative collectors.
Live SSH, live Open DeskOS Link, deployed hosts, Windows, CM5, and physical input remain unverified.

## Electron verification profile and lifecycle repair

These checks completed on 2026-10-09.
The paired Pi acceptance command passed, but its complete Shell runs repeatedly failed Futu cleanup and HTML verification cases.
Diagnostic assertions identified the retained Futu path as the temporary Electron profile.
The diagnostic complete run passed 1,350 checks, failed that cleanup check, and skipped two checks.
HTML verification passed in that run, but a later focused run reported its existing `verification-timeout` result.

The [Futu parent check](../tests/futu-service-isolation.test.js) now allocates the profile and passes its exact path through Electron arguments and fixture environment.
The child sets both Electron profile paths before readiness and leaves the supplied profile with its parent.
The parent removes it after the child closes, including failed execution.
Marker equality checks the executed profile, while existing checks retain signed-store and connected-publisher cleanup acceptance.
The child retains its previous cleanup path for manually allocated profiles.
The new parent-path assertion failed before the child accepted the supplied profile.

The [verification runner](../src/user-app-verifier-runner.js) now explicitly sets private `userData` and `sessionData` before readiness and hides its macOS Dock entry.
Its hidden window disables background throttling while retaining context isolation, disabled Node integration, sandbox, permissions, and network restrictions.
The verification deadline remains eight seconds.
The [runner regressions](../tests/user-app-runtime.test.js) execute controlled construction and fail without explicit session isolation and unthrottled hidden-window configuration.
Existing real Electron checks retain concurrent verification, visible content, script rejection, network confinement, and hostile-script deadlines.
The CLI fixture now reports verification failures for its synthetic package without hiding the verifier's reason behind the generic command failure.

The focused runtime, Futu isolation, and package CLI command passed all 28 checks.
Fresh independent review found no blocking issues and independently passed both controlled runner checks.
The final complete Shell run passed 1,353 checks, skipped two checks, and reported no failures.
The passing focused command does not establish the complete cause of the earlier HTML timeout.
The controlled runner checks prove option wiring; they do not establish actual Chromium scheduling behavior.
Futu timeout acceptance covers cooperative child shutdown, rather than parent death, forced termination, or surviving descendants.
Production activation, deployed Windows or CM5, and physical input remain unverified.

## Signed Pi revision operation verification

These checks completed on 2026-10-09.
The [revision cases](../tests/pi-plugin-parity.test.js) independently exercise actual Native CLI update, rollback, and removal for Pi Sessions and Pi Events.
The [bundle helper](../tests/helpers/pi-events-selection.js) signs revision-specific entry code and manifest bytes under the existing temporary publisher policy.
Each actual returned source function receives a non-enumerable fixture execution marker from its signed entry.
The marker identifies executed code separately from the selected manifest version.
Initial marker assertions failed before these execution markers were added.

Updating one stored selection leaves both running source instances and consumer responses unchanged.
The other source's stored selection, trust record, and grants remain unchanged.
Complete Host shutdown removes owned handlers and rejects retained cleanup failures before new composition.
The new Host executes revision 3.0.0 for the updated identity and revision 2.0.0 for its peer.
Actual session IPC, event IPC, and Open DeskOS Data responses match the initial baseline.

Changing incoming entry bytes without signing rejects the update with a native hash mismatch.
The rejection preserves configuration bytes, both running instances, and consumer responses.
Rollback preserves the active revision until shutdown and executes revision 2.0.0 after new composition.
Removal likewise leaves the active instance until shutdown, then restores its actual default factory.
The signed peer remains selected and available throughout each operation.
Native store verification checks both retained revisions and the peer revision after removal.

The focused parity, Native CLI, manager, loader, and source lifecycle command passed 131 checks.
Fresh independent review found no actionable defects and independently passed both revision cases.

An initial complete run passed 1,350 checks, failed three checks, cancelled two checks, and skipped two checks.
Its failing or cancelled cases involved Futu, Quota, package CLI verification, and two actual Electron verifier cases.
Several task-owned Electron processes remained alive past their deadlines and subsequently exited without manual termination.
These observations do not establish the underlying host or scheduling cause.

The Futu negative fixture previously rendered the default UI before reaching its declared signed-publisher timeout stage.
The updated mode constructs only the signed source and reports its acknowledged publisher connection before any renderer document loads.
Its marker records the actual empty renderer URL, which the parent checks alongside profile, store, and endpoint cleanup.
The pre-fix negative regression exceeded its 15-second test deadline; the corrected check passed.
Ordinary positive acceptance still compares default and signed rendering through its original theme matrix.
Fresh follow-up review found no actionable stage, ownership, or contract issues.

The sequential-file Futu, package CLI, Quota Electron, and verifier command passed all 29 checks.
Its concurrent-verifier case still starts two independent children.
The subsequent complete Shell command passed 1,355 checks and skipped two checks, without failures or cancellations.

These checks use temporary policy, configuration, bundles, and revision storage.
They do not establish Electron process restart, runtime hot replacement, production Main startup, rendered consumers, or live providers.
Windows, CM5, deployment, and physical input remain unverified.

## Pi rendered consumer verification

These checks completed on 2026-10-09.
The [Electron check](../tests/pi-electron.test.js) runs its [hidden fixture](../tests/pi-plugin-electron.cjs) with a parent-owned temporary profile.
The fixture sets both Electron profile paths before readiness and refuses permission requests and new windows.
The actual preload and IPC handlers connect the Pi page to the selected source factories.
Other external services use isolated fixture responses.

Default and independently signed Pi Sessions and Pi Events use the same synthetic source responses.
The Native CLI installs both replacements under temporary publisher policy, explicit trust, and exact source and IPC grants.
Actual source functions carry signed execution markers; default constructors throw when signed implementations are selected.
Complete Host shutdown removes both handlers before the next composition.
Retained cleanup failures cannot certify successful shutdown.

Three themes and wide and compact sizes preserve session rows, filters, details, live announcements, and synthetic navigation.
Transcript checks preserve multiline English and CJK, folded reasoning, and recorded tool identities and outcomes.
Rendered event HTML participates in parity, with explicit English and CJK paragraph assertions.
Delayed initial session and event responses retain their actual loading states.
Empty, unavailable, malformed, unreadable, and recovered responses match the default consumer baseline.
The fixture checks horizontal control bounds and waits for the project fonts before collection.

The initial Node check failed because its Electron fixture was absent.
An expanded delayed-event check timed out because separate fixture promises retained earlier requests.
The corrected fixture shares one controlled event promise and waits for document load before renderer inspection.
The final focused Electron command passed its complete default and signed matrix.

Fresh review identified stale-state synchronization and flattened-transcript evidence gaps.
The fixture now restores valid sessions before malformed responses and compares event HTML structures.
The corrected focused command passed, and independent follow-up review found no new actionable defects.
The final complete Shell command passed 1,356 checks and skipped two checks, without failures or cancellations.

This fixture constructs the actual Main plugin composition with only Open DeskOS Link and the two Pi sources selected.
It does not start production Main, use live providers, or compare screenshots.
Synthetic keyboard and Remote events do not establish native or physical input acceptance.
Electron process restart, revision transitions in rendered consumers, Windows, and CM5 remain unverified.

## Signed WeRead consumer verification

These checks completed on 2026-10-09.
The [shared WeRead checks](../tests/weread-plugin-parity.test.js) now run their complete source scenarios against default, development-linked, and signed independent implementations.
The [signed helper](../tests/helpers/weread-selection.js) installs through the actual Native CLI with temporary publisher policy, explicit trust, and exact grants.
The signed bundle captures its independent source entry and the existing public projection, common helpers, and health module.
The source implementation remains independent; the projection remains shared rather than independently reimplemented.

The initial signed-selection assertion rejected a development link before native installation was added.
Actual signed entry execution places a non-enumerable revision marker on the returned source.
The injected default constructor rejects calls whenever a replacement is selected.
Entry and projection module files change after discovery, before factory construction.
The selected source still preserves IPC, Open DeskOS Data, cached health, provider requests, covers, selection, and cache behavior.

The signed matrix includes asynchronous cancellation and drain checks for notebook requests, cover requests, parallel bookmark requests, and response bodies.
It preserves late-write suppression and concurrent IPC and reading completion order.
Corruption before discovery reports the native hash rejection and starts the actual default source.
Default IPC, Open DeskOS Data, and health match the uncorrupted baseline.
The retained corrupted revision still fails native store integrity verification.

Removal follows complete Host shutdown, absent handlers, and no retained cleanup failures.
Native removal reports a selection-only effect and leaves no selected replacement.
Native store verification preserves every signed file and the original descriptor bytes.
The next default composition restores the same IPC, Open DeskOS Data, and health using the retained highlight cache.
Development-link removal also preserves its source package and the same consumers.

The focused source, source-reading, native loader, Native CLI, and parity command passed all 66 checks.
Fresh independent review found no actionable defects and separately passed all 39 WeRead parity checks.
The complete Shell command passed 1,370 checks and skipped two checks, without failures or cancellations.
The [public contract](WEREAD_PLUGIN_CONTRACT.md) records capability options, provided ports, consumer behavior, and acceptance limits.

All provider responses, cache files, configuration, publisher policy, and revisions belong to temporary fixtures.
These checks do not establish live provider compatibility, rendered consumers, signed updates or rollback, or Electron process restart.
Windows, CM5, deployment, and physical input remain unverified.

## WeRead rendered consumer verification

The rendered checks ran on 2026-10-09.
The [Electron fixture](../tests/weread-plugin-electron.cjs) compares default and signed independent WeRead sources through actual Main composition and preload.
Its hidden window uses parent-owned temporary user-data and session-data paths before readiness.
The fixture refuses default construction when the signed source is selected.
Execution markers and post-discovery file mutations verify the captured implementation.
Its shared projection modules remain the existing public reading contract.

The matrix covers Instrument, Pixel, and Border Beam at wide and compact sizes.
Loading, live, empty, error, recovery, and unconfigured states preserve the same visible content.
Missing metadata and rejected covers retain plain text without an unsafe HTML element.
Cover checks compare decoded red and blue regions, aspect ratio, and full canvas bytes.
Geometry checks require positive dimensions and containment on both axes.
Actual renderer disable and enable operations exercise remounts; source shutdown removes the owned IPC handler.

Stronger checks reproduced clipped compact excerpts and a fractional fitting step below the fourteen-pixel floor.
Separate regression checks reproduced incorrect fitting when the resolved row gap exceeded the fallback.
The repair reserves the resolved gap, clamps the minimum, and keeps remaining excerpt overflow scrollable.
It preserves complete source text, metadata, cover behavior, and source contracts.
This is an explicit readability repair, not evidence that the previous layout was correct.

Electron input delivered Home to the focused excerpt without returning to its start.
The plugin now handles Home and End explicitly while retaining native direction and page scrolling.
Unit checks preserve Shell Escape and horizontal navigation behavior.
Actual Electron input verifies Home and End scrolling, retained focus, and unchanged Reading page ownership.
Programmatic tail checks also require the final character to reach the visible region.

The final focused parity, renderer, layout, and icon command passed all 56 checks.
The isolated `pnpm styles` and `widget-app-styles.cjs` commands passed.
Density checks passed three themes, two states, and five sizes without violations or relaxed profiles.
The E2E isolation regression checks passed all six cases after both profile paths were set before fixture loading.
The complete `pnpm e2e` command passed its driver, motion, sweep, interior, refinement, density, and theme gates.
The first full Shell run found a broken repository link in the newly packaged Widget skill reference.
The reference now uses repository `@path` pointers; source and packaged skill checks passed.
The final complete Shell command passed 1,375 checks and skipped two Windows-specific checks, without failures or cancellations.
Fresh independent source review found no actionable introduced defects.
The review did not run executable checks.
Existing Widget resize-observer ownership and pending-render cleanup remain separate lifecycle concerns.

Provider responses, cache, publisher policy, configuration, revisions, and Electron profiles belong to temporary fixtures.
These results do not establish live provider compatibility, signed updates or rollback, or Electron process restart.
Windows, CM5, deployment, physical input, and assistive-technology acceptance remain unverified.

## WeRead Widget resource ownership verification

The Widget lifecycle checks ran on 2026-10-09.
The [Widget checks](../tests/weread-tile.test.js) use the actual renderer registry for release, remount, and failed cleanup retry.
Before repair, four cases reproduced late reading success, late reading rejection, missing observer release, and an older cover overwriting the current cover.
The [Widget](../src/renderer/plugins/weread.js) now registers scoped cleanup before it creates asynchronous resources.
It owns one local resize observer, a scheduled fitting frame, and the current cover image.
Release blocks further rendering, cancels fitting, clears image callbacks, and disconnects the observer.
The registry retains a failed observer cleanup for retry without repeating successful tick cleanup.

Controlled responses prove that released reading success and rejection cannot overwrite remounted content.
Captured frame, observer, and tick callbacks cannot access released nodes.
Controlled image completion proves that older covers cannot draw over or hide the current cover.
Removing a cover also invalidates its old callbacks.
Each new mount receives a new observer.
These request and image race checks use controlled callbacks, not physical input or live network timing.

The [Electron fixture](../tests/weread-plugin-electron.cjs) wraps native resize observers during actual Widget remounts.
It checks one tracked WeRead observer while enabled and none after disable or final renderer shutdown.
Default and signed independent source modes retain actual preload and the same rendered parity matrix.
The shared Main source remains running through Widget remounts.
View release ignores late IPC completion; source shutdown owns actual provider cancellation and drain.

Independent review reproduced an introduced restart of pending cover loads on each shared tick.
A new regression failed before the requested theme was tracked during pending decoding.
Unchanged ticks now retain the pending load; source or theme changes supersede it.
Failed theme-change loads retain their existing tick retry behavior.
Same-theme replacement decode failures retain their previous behavior.
The final focused command passed all 99 source, renderer, parity, lifecycle, layout, and icon checks.
The final `pnpm e2e` command passed its driver, motion, sweep, interior, refinement, density, and theme gates.
The final complete Shell command passed 1,381 checks and skipped two Windows-specific checks, without failures or cancellations.
Follow-up independent review confirmed the pending-load repair and found no remaining introduced lifecycle or concurrency defects.
The follow-up review did not rerun GUI or suites.
Live provider timing, process restart, signed updates or rollback, assistive technology, Windows, and CM5 remain unverified.

## WeRead signed revision and separate process verification

The revision and process checks ran on 2026-10-09.
The [signed helper](../tests/helpers/weread-selection.js) creates distinct version-two and version-three bundles under one temporary publisher policy.
Each signed entry places its execution marker on the returned source.
Both versions retain the independent source algorithm and explicitly bundled public projection modules.
The actual Native CLI requires temporary publisher policy, explicit trust, and exact source and IPC grants.

The [revision checks](../tests/weread-revision.test.js) cover configured live synchronization and unconfigured cached consumers.
Update, rollback, and removal change only selection records while the current source remains available.
Complete Host shutdown removes owned handlers before new Main composition executes the selected source or actual default constructor.
IPC, Open DeskOS Data, health, cache bytes, source enable preference, and an unrelated Clock preference remain unchanged.
An unsigned update preserves configuration bytes and the current source.
Removal preserves both verified signed revisions.
Controlled live synchronization occurs once; subsequent revision transitions retain the fresh cache without extra provider requests.

The [process checks](../tests/weread-restart-electron.test.js) reuse the [rendered fixture](../tests/weread-plugin-electron.cjs) with externally selected revisions.
Four separate Electron processes execute version two, version three, rollback to version two, and the restored default.
Reported process identities match the actual spawned children.
Selected source markers and poisoned default construction prevent silent fallback during signed acceptance.
Each process retains actual Main Host composition, preload, and the mounted Widget.
Three themes and wide and compact sizes preserve the same complete rendered state matrix across all four stages.
Parent-owned profiles set user-data and session-data paths before readiness and are removed after child completion.
The shared native configuration and store persist across processes; both stored revisions retain their verified bytes after removal.

The initial revision cases failed because the helper could not create distinct signed bundles.
The initial process case failed because the fixture did not consume or report external revision selections.
The final focused source, renderer, parity, loader, Native CLI, revision, and process command passed all 81 checks.
The complete Shell command passed 1,384 checks and skipped two Windows-specific checks, without failures or cancellations.
Fresh independent source review found no actionable fixture, selection, lifecycle, or proof defects.
The review did not run tests; it confirmed the separate limits for controlled process startup and cache continuity.

Provider responses and rendering caches are replayed inside each private Electron fixture.
Cache preservation across Host reconstruction is checked separately from the process rendering matrix.
These checks do not establish production `src/main.js` startup, live provider compatibility, deployed revision changes, or runtime replacement.
Windows, CM5, physical input, and assistive-technology acceptance remain unverified.

## Independent Weather source and signed consumer verification

The [independent source](../tests/fixtures/weather-replacement/source.cjs) now owns Weather requests, response decoding, cache handling, and cancellation.
It does not import the default Weather source or call its factory.
Device-location behavior and public reading and health projections remain explicit shared dependencies.
This implementation supersedes the earlier Weather fixture that reused the default provider library.
It preserves the existing provider protocol; an alternative provider still needs separate acceptance.

The [source scenarios](../tests/weather-source.test.js) run unchanged assertions against default and independent algorithms.
They cover configured and device locations, response validation, labels, cache behavior, freshness, concurrent requests, deadlines, and cancellation.
The [shared consumers](../tests/weather-plugin-parity.test.js) run against default, development-linked, and signed implementations.
They exercise actual Main composition, IPC, Open DeskOS Data, cached health, disable, enable, cancellation, and cleanup retry.
The signed fixture uses actual Native CLI installation with temporary publisher policy, trust, and explicit grants.
An execution marker identifies the actual source, while the default source constructor rejects replacement use.
After discovery, stored source and dependency mutations do not change captured execution or re-enabled instance behavior.
These mutations occur only in task-owned test storage.

The focused source, consumer, native loader, native CLI, and device-location command passed 100 checks.
The final Shell Node suite passed 1,416 tests, skipped two platform-specific tests, and reported no failures from 1,418 tests.
Fresh independent review found no introduced blocking findings.
The reviewer reproduced a relocation defect in both algorithms: an earlier coordinate response can receive a later place label.
This is a baseline defect, not evidence of correct concurrent relocation.
The replacement scenarios do not yet cover that input-identity transition.

These checks do not establish rendered Weather parity, signed update, rollback, removal, production startup, or alternative providers.
Windows, CM5, real provider behavior, physical input, and deployed replacement acceptance remain unverified.

## Signed Weather revision operation verification

The [revision scenarios](../tests/weather-revision.test.js) exercise actual Native CLI update, rollback, and removal with cached and controlled live readings.
The [bundle helper](../tests/helpers/weather-selection.js) signs distinct versions with one temporary publisher identity and policy.
The scenarios failed before the helper supported distinct signed bundles.

Selection changes preserve the running source object until complete Host shutdown and reconstruction.
New compositions execute signed version `3.0.0`, rolled-back version `2.0.0`, and the default implementation after removal.
Actual source markers identify signed execution; the default construction capability rejects signed use.
IPC, Open DeskOS Data, cached health, persisted cache bytes, and unrelated plugin preferences remain unchanged.
Unsigned entry changes fail without changing configuration bytes or the running source.
Both retained signed revisions remain verified after removal.
Each new live source receives one forced controlled refresh, while fresh consumer reads avoid additional requests.

The focused source, consumer, revision, native loader, native CLI, and device-location command passed 102 checks.
The final Shell Node suite passed 1,418 tests, skipped two platform-specific tests, and reported no failures from 1,420 tests.
Fresh independent read-only review found no introduced findings.
These scenarios construct the Node Plugin Host with Weather and Open DeskOS Data and use child processes for Native CLI operations.
They do not establish separate Electron process startup, preload or rendered parity, production bootstrap, live services, or device acceptance.
The later relocation repair section supersedes the relocation limitation recorded above.

## Weather relocation identity repair

Fresh review reproduced a shared baseline defect in default and independent Weather sources.
Earlier coordinate responses could publish readings or errors with a later place label and cache location.
Additional regressions reproduced reversed lookup results and stale readings incorrectly treated as fresh after relocation.

Both algorithms now retain request location identity through response decoding, publication, and cache writes.
Responses and errors from superseded locations cannot change the current state or cache.
Changed locations invalidate freshness while retaining previous values with their original labels as stale.
New provider work waits for the prior location request to settle.
Older lookup results cannot overwrite newer selections.
Concurrent device lookups still share applicable provider work.
Cancellation prevents queued relocation requests from starting.

Independent review found an introduced force-loss regression during lookup merging.
A failing regression confirmed that a later ordinary lookup could suppress an explicitly forced refresh.
The repair now checks actual provider acquisition before considering a forced refresh satisfied.

The [shared source scenarios](../tests/weather-source.test.js) control lookup and provider completion without timing delays.
The [consumer scenarios](../tests/weather-plugin-parity.test.js) check relocation through actual Main composition, IPC, Open DeskOS Data, health, and persisted cache.
These consumers run against default, development-linked, and signed implementations.
The focused source, consumer, revision, location, native loader, and native CLI command passed 119 checks.
The final Shell Node suite passed 1,435 tests, skipped two platform-specific tests, and reported no failures from 1,437 tests.
Follow-up independent review confirmed preserved force behavior and successful-request coalescing without remaining correctness findings.
Completed failed requests can still be retried; the source does not share completed failures.
This repairs an existing correctness defect without changing source ports, reading fields, configuration, or cache format.
These controlled checks do not establish real location services, rendered relocation, physical input, or device acceptance.

## Weather Electron consumer verification

The [Electron check](../tests/weather-electron.test.js) launches the [hidden fixture](../tests/weather-plugin-electron.cjs) with a parent-owned temporary profile.
The fixture sets `userData` and `sessionData` before readiness and denies permission requests and new windows.
It uses actual Main plugin composition, actual preload, and the existing Weather Widget.
Only the Weather source runs in Main; unrelated renderer providers use controlled geometry fixtures.
Provider responses and time are controlled; no real Weather service is queried.

Default and signed independent sources produce matching waiting, live, stale, unavailable, unconfigured, and recovery consumer states.
The comparison covers Instrument, Pixel, and Border Beam themes at `1920x1280` and `480x854`.
It checks mixed English and CJK place text, negative three-digit temperature, daily limits, units, badges, conditions, and condition glyph markup.
It also checks loaded fonts, minimum text sizes, positive element dimensions, and containment on both axes.
No interactive controls appear in the display-only Weather Widget.
Renderer disable and enable operations leave the shared Main source object and its IPC handler available.

The signed fixture uses actual Native CLI installation and checks the executed source marker after each source restart.
Its default source construction capability rejects signed use.
Task-owned stored module changes after discovery do not affect captured execution.
The initial scenario failed because the Electron fixture was absent.
An initial geometry run found the compact Weather tile below the visible Home area.
The fixture now scrolls the existing page to the Widget before checking viewport containment.
This is programmatic scrolling evidence, not physical input acceptance.

The focused source, consumer, revision, Electron, native loader, native CLI, and device-location command passed 120 checks.
The final Shell Node suite passed 1,436 tests, skipped two platform-specific tests, and reported no failures from 1,438 tests.
Fresh independent review found no blocking findings and identified missing daily-label geometry coverage.
The fixture now checks both daily labels through `querySelectorAll` and verifies their exact text.
These checks do not establish separate Electron revision restarts, production bootstrap, rendered relocation, alternative providers, or deployed hosts.
Windows, CM5, physical input, and assistive-technology acceptance remain unverified.

## Weather signed revision and separate process verification

The [process scenario](../tests/weather-restart-electron.test.js) uses actual Native CLI update, rollback, and removal between four independent Electron launches.
Each child loads the parent's persistent plugin configuration, publisher policy, and signed revision store.
The [rendered fixture](../tests/weather-plugin-electron.cjs) uses a separate parent-owned profile for each child.
External selection mode does not install another bundle or mutate retained signed modules.

Each child reports the source revision from the executed port, with the Host manifest checked against the expected selection.
Signed execution rejects default source construction.
Reported process IDs match spawned child IDs and differ across all four launches.
The complete six-state consumer matrix matches version `2.0.0`, updated version `3.0.0`, rolled-back version `2.0.0`, and the restored default.
The matrix includes three themes and two sizes through actual preload and the existing Weather Widget.

Unsigned update changes fail without modifying configuration bytes.
Removal preserves both signed revisions, whose verified stored files remain unchanged.

The initial process scenario failed because the original fixture did not expose external revision execution.
The final paired Electron command passed both normal rendering and separate process scenarios.
The focused source, consumer, revision, Electron, process, native loader, native CLI, and device-location command passed 121 checks.

The subsequent complete Shell command reported 1,430 passed, four failed, three cancelled, and two skipped checks.
Failures included Main readiness, Electron verification, CLI installation, Futu cleanup, Pi rendering, and Weather process deadlines.
The Main wiring harness used a fixed polling count instead of waiting for window load.
It now waits for that completion event with a bounded failure deadline; all 18 Main wiring checks passed afterward.

The paired Weather process and application-runtime rerun passed 17 checks and failed concurrent Electron verification.
All four Weather revision processes completed, including the shared cache phase.
The isolated concurrent-verifier case subsequently passed without changing deadlines or concurrent execution.
The serial failed-check group subsequently passed all 29 Futu, Pi, CLI management, and application-runtime checks.
Its concurrent-verifier case retains two simultaneous children and the original deadlines.
The subsequent complete Shell run passed 1,434 checks, failed three checks, and skipped two checks without cancellations.
The three failures concern CLI installation and actual Electron verifier success cases.
The observed host load exceeded 120, but this observation does not identify the failure cause.
The final Shell Node suite passed 1,437 tests, skipped two platform-specific tests, and reported no failures from 1,439 tests.
Fresh independent read-only review found no introduced findings.

Each child replays provider responses with a private rendering cache.
Host cache-byte preservation is verified separately by the Node revision scenarios.
These checks do not establish cross-process cache continuity, production `src/main.js` bootstrap, rendered relocation, live providers, or deployed hosts.
Windows, CM5, physical input, and assistive-technology acceptance remain unverified.

## Weather cache continuity across separate processes

The [process scenario](../tests/weather-restart-electron.test.js) now adds a shared persistent cache phase after each child's rendering matrix.
The [fixture](../tests/weather-plugin-electron.cjs) constructs the selected source with the parent-owned cache path.
The parent supplies no seeded reading.
The first signed source obtains and writes a live provider response through actual source handling.

Updated, rolled-back, and restored default sources load that reading before their first provider request.
Their controlled provider rejects refreshes, preserving the reading as stale.
Actual preload and the existing Widget retain the place, units, current temperature, condition, glyph, and daily limits.
Cached health reports degraded for offline consumers and healthy for the initial live consumer.
The parent compares complete reading values and exact cache bytes after each child closes.
Private rendering-matrix caches remain separate from the shared continuity cache.

The persistent path must be absolute and share the parent-owned profile root.
This mode requires external revision selection.
Children do not delete the shared cache; the parent releases it only after child completion.
The initial scenario failed because the fixture did not execute or report this continuity phase.
The paired Electron checks passed with successful initial acquisition and offline revision consumers.

Independent review found no blocking findings and recommended explicit acquisition-order evidence.
The fixture now counts provider calls and verifies zero calls at the initial source snapshot.
The focused source, consumer, revision, Electron, process, native loader, native CLI, and device-location command passed 121 checks.

This evidence supersedes the earlier cross-process cache limitation for the controlled configured-location scenario.
It does not establish production `src/main.js` bootstrap, real provider outages, rendered relocation, physical input, or device acceptance.

## Weather Main bootstrap verification

The [bootstrap scenario](../tests/weather-main-bootstrap.test.js) installs the signed independent Weather source through the actual Native CLI.
Its [hidden wrapper](../tests/weather-main-bootstrap.cjs) requires the actual `src/main.js` entry without smoke mode.
Main loads the persistent native selection and constructs its actual Plugin Host, preload, and Shell window.
Selected Host manifests and executed source markers identify installed version `2.0.0`, updated version `3.0.0`, and rolled-back version `2.0.0`.
Default constructor poisoning detects fallback during signed startup.

The wrapper supplies controlled Weather responses and disables unrelated Main factories through its temporary environment.
Actual preload and the existing Widget expose the same live place, temperature, unit, condition, and daily limits.
Actual CLI update, rollback, and removal precede independent Main startups that preserve those values.
Removal restores the default source in the fourth process.
Reported process IDs match spawned child IDs and differ across all four stages.
Unsigned updates preserve configuration bytes, and removal retains both verified signed revisions without changing their files.

Normal application quit waits for the Main shutdown barrier and removes the owned Weather IPC handler before exit.

All four processes use private parent-owned user and session profiles with isolated configuration and native storage.
The wrapper normalizes Electron's application path to the production Shell root and suppresses window display.
Passive Host capture, IPC registration tracking, and constructor counters supply execution evidence without replacing native loaders or Main composition.
The initial scenario failed because its bootstrap wrapper was absent.
The completed bootstrap scenario passed with both signed and restored default consumers.

The later revision scenario first failed because the wrapper did not report executed versions.
Its completed four-process update, rollback, rejection, and removal check passed.
Fresh independent review found no blocking defects in revision selection, consumer parity, or normal shutdown evidence.

The focused Main, native loader, native CLI, Weather parity, and bootstrap command passed all 59 checks.
Independent review confirmed execution and shutdown evidence and identified inherited kiosk settings as an isolation concern.
The parent now fixes non-kiosk mode and window dimensions for each child.
The bootstrap check also passed with kiosk mode enabled in the parent environment.
After the revision extension, the final full Shell command passed 1,438 checks and skipped two checks without failures or cancellations.

This evidence covers controlled configured-location Weather startup, update, rollback, and removal through the actual Main entry.
It does not establish full-service startup, live providers, persistent cache across this entry, runtime hot replacement, or deployed hosts.
The wrapper does not establish packaged startup or visible-window interaction.
Windows, CM5, physical input, and rendered relocation remain unverified.

## Camera capture ownership repair

The [Camera contract](CAMERA_PLUGIN_CONTRACT.md) now defines pending capture ownership and source shutdown alongside existing frame consumers.
Shared default and independent-source regressions first reproduced disable completion before capture release.
An additional regression reproduced lost ownership when a provider synchronously requested source stop.
Both implementations now register ownership before provider execution and drain every pending capture before release.
Cancellation clears cached frames, prevents new captures, and suppresses late frame publication.
Main registers source cleanup before its IPC handlers and retains legacy sources without a stop method.

The focused Camera, source composition, replacement, Main wiring, P4 protocol, and Plugin Host command passed all 82 checks.
Fresh independent review found no blocking lifecycle, ownership, or concurrency regression.
The final complete Shell command passed 1,445 checks and skipped two checks without failures or cancellations.
These checks use controlled providers without live camera or microphone access.
The subsequent capture-provider section records signed replacement evidence and remaining acceptance gates.

## Camera capture provider and signed replacement verification

The default Camera source now exposes a separate raw capture provider through the existing `source.camera` capability.
Main supplies `provider(options)` alongside the retained default `create(options)` constructor.
Provider construction starts no capture, and the bounded command retains its existing lock, arguments, dimensions, and temporary-file cleanup policy.
Default and independent sources own validation, encoding, cache, throttle, and lifecycle behavior.
The independent entry imports no default source module and does not call its constructor.

The [shared checks](../tests/camera-plugin-parity.test.js) now include actual Native CLI signed installation with temporary publisher policy, trust, and exact grants.
The [helper](../tests/helpers/camera-selection.js) signs only the independent entry and manifest.
No default source library is copied into the signed bundle.
After discovery, every signed case changes the stored entry before actual Host construction.
Executed source markers and default constructor poisoning verify captured selection.

All three implementations preserve frame payloads, cached health, capture intervals, invalid frames, provider errors, missing devices, and restart.
Shared ownership cases cover delayed disable, provider reentry, and multiple active captures.
The initial provider check failed before the capture capability existed; initial signed cases failed before their helper existed.
The focused Camera, composition, Main wiring, native loader, native CLI, P4 protocol, and Plugin Host command passed all 109 checks.
Fresh independent review found no blocking provider, lifecycle, capability, or signed-selection findings.
The final complete Shell command passed 1,450 checks and skipped two checks without failures or cancellations.

These checks use controlled raw frames without live capture.
The subsequent Camera revision section records selection-transition evidence and remaining acceptance gates.

## Camera signed revision verification

The [revision cases](../tests/camera-revision.test.js) exercise actual Native CLI update, rollback, unsigned rejection, and removal for live and unavailable consumers.
Distinct signed bundles execute versions `2.0.0` and `3.0.0` through actual Main composition, Plugin Host, and Native loader.
Default constructor poisoning and executed source markers verify each signed selection.
Stored selection changes retain the running source until complete shutdown and new composition.
Removal restores the actual default constructor on the next composition startup.

IPC frames, cached health, enable state, and unrelated Clock preferences remain unchanged across each stage.
Unsigned updates preserve exact configuration bytes and leave the active source unchanged.
Removal retains both signed revisions, whose complete stored files pass verification and remain unchanged.
Each new instance performs one controlled capture; cached consumers and health add no provider work.
Host shutdown removes Camera IPC handlers and leaves no controlled temporary-frame files.

The initial cases failed because the signing helper could not construct distinct revision bundles.
The focused Camera revision, source, composition, Main wiring, native loader, native CLI, P4 protocol, and Plugin Host command passed all 111 checks.
The complete Shell command passed 1452 checks, skipped two checks, and reported no failures.
Fresh independent review found no actionable selection, provenance, consumer, or cleanup issues.
These cases use temporary configuration, publisher policy, state, and controlled providers without live capture.
The subsequent Camera bootstrap section records separate actual Main and preload evidence.
Rendered consumers, real provider commands, Windows, CM5, and physical Camera acceptance remain unverified.

## Camera actual Main bootstrap verification

The [bootstrap cases](../tests/camera-main-bootstrap.test.js) load actual Main through an isolated Electron wrapper.
Each live or unavailable state uses four distinct processes for signed installation, update, rollback, and restored default selection.
Actual preload supplies identical frames, dimensions, capture times, and unavailable results across those revisions.
Executed source markers verify each signed revision without default source construction.

The production capture primitive receives virtual files and an injected command implementation.
The controlled command checks the existing lock command, device argument, and MJPEG dimensions without executing a physical command.
Each process performs one controlled acquisition attempt.
Cached health rejects source refresh and performs no additional capture.
Normal shutdown removes Camera IPC, stops the source, and leaves no virtual frame files.

Unsigned candidate mutation preserves exact configuration bytes.
Removal retains both signed revisions, whose captured file maps remain verified and unchanged.
Child closure precedes private profile removal, including rejection paths.
The CLI helper requires isolated state, accepts an optional cancellation signal, and awaits actual command process closure.

The initial fixture access checks failed before the bootstrap wrapper existed.
The focused bootstrap, source, parity, and revision command passed all 25 checks.
The shared Camera, Main wiring, replacement, native loader, CLI, and Host command passed all 100 checks.
That complete Shell command reported 1498 checks: 1496 passed, none failed, and two were skipped.
The skipped checks require Windows named-pipe authentication and PowerShell microphone-name handling.
Fresh independent review found no actionable bootstrap, isolation, integrity, or cleanup defects.

These checks use hidden windows, private profiles, and controlled providers on local macOS.
Other Main factories and packaged content surfaces remain disabled.
Frame bytes have JPEG markers without image decoding or pixel acceptance.
Actual provider processes, physical capture, rendered replacement parity, Windows, and CM5 remain unverified.

## Independent signed Hydra verification

The [shared cases](../tests/hydra-plugin-parity.test.js) compare default, development-linked, and signed Hydra sources through actual Main composition and Plugin Host.
The [replacement entry](../tests/fixtures/hydra-replacement/entry.cjs) independently implements protocol parsing, snapshots, reading projection, cached health, and connection ownership.
It imports no Shell implementation modules and never calls the default source factory.
The [signing helper](../tests/helpers/hydra-selection.js) uses actual Native CLI installation, temporary publisher policy, exact grants, and captured verified entry bytes.
Executed source markers identify the signed version; changing its stored entry after discovery does not change execution.

Shared scenarios preserve retained and live values, soil limits, disconnected sensors, watering states, diagnostics, timestamps, stale boundaries, and rejected messages.
IPC, Open DeskOS Data, cached health, and update counts match the default source across the protocol transition sequence.
Connection retries preserve subscription scope and existing timeouts.
Disable waits for the client completion callback; uncertain release blocks another connection.
Health queries do not create connection work.

The initial signed cases failed without a signing helper, and the independence assertion rejected default implementation imports.
The focused Hydra, source composition, Main replacement, native loader, native CLI, and Plugin Host command passed all 100 checks.
The first RED fixture accidentally staged three candidates in the default state directory while using temporary configuration.
Later cases use parent-owned temporary state; an isolation assertion rejects external state directories before any writes.
Those earlier candidates remain preserved because their cleanup ownership cannot be established from the retained evidence.

Fresh independent review found no actionable protocol, provenance, isolation, or ownership issues.
The complete Shell command reported 1462 checks: 1456 passed, two failed, two were cancelled, and two were skipped.
Futu timeout cleanup, HTML rollback verification, concurrent HTML verifiers, and separate-process WeRead revisions did not complete successfully.
The Hydra checks passed within that run.
A separate command reran the four affected files and passed all 29 checks, including two concurrently running HTML verifiers.
These results do not establish the cause of the complete-run failures.

The second complete run reported 1462 checks: 1453 passed, two failed, five were cancelled, and two were skipped.
Its Futu, HTML verifier, Weather, and WeRead failures leave the complete gate unresolved.
One task-owned Electron child of an already-failed Weather bootstrap case required forced termination before the runner could finish.

These checks use controlled MQTT clients without a broker or physical input.
The signed Hydra revision section below records selection transitions through controlled Node Hosts.
Actual Electron bootstrap, rendered consumers, live broker behavior, Windows, CM5, and physical Hydra acceptance remain unverified.

## Futu acceptance deadline and window isolation

The [parent fixture](../tests/futu-service-isolation.test.js) retains its 10000 ms child deadline and 15000 ms test deadline.
Its child deadline now uses `SIGKILL`, which cannot be ignored by the owned Electron process.
Profile removal still follows child closure.
Forced termination cannot satisfy the required exit code, timeout marker, signed-store provenance, and resource-removal checks.

The [negative child fixture](../tests/futu-service-electron.cjs) connects its signed publisher without constructing a Renderer window.
Its report includes the actual window count, and the parent requires zero windows.
Normal rendered acceptance still constructs its original window.
The [wiring regressions](../tests/futu-service-isolation-wiring.test.js) first failed for the default termination signal and the unnecessary window.
Both regressions now pass using controlled process and Electron interfaces.

The real Electron negative fixture and focused Futu, native loader, and Plugin Host command passed all 52 checks.
Fresh independent review found no actionable deadline, profile-ordering, or window-path issues.
An earlier real run required forced termination and correctly failed its exit-code assertion instead of certifying cleanup.
These results preserve the original deadlines and acceptance assertions.

The preceding complete run failed; its recorded Futu and Weather failures precede these fixture changes.
The subsequent complete run passed both wiring regressions and the real Futu negative fixture.
That run reported 1464 checks: 1459 passed, one failed, two were cancelled, and two were skipped.
Pi and WeRead rendered-consumer timeouts and HTML installation verification failure leave the complete gate unresolved.

Complete-suite, live provider, deployed-host, Windows-device, and CM5 acceptance remain unresolved.

## Signed Hydra revision verification

The [revision cases](../tests/hydra-revision.test.js) exercise actual Native CLI update, rollback, unsigned rejection, and removal.
Each operation covers live, stale, unavailable, and unconfigured consumers through actual Main composition and Plugin Host.
Executed source markers verify signed versions `2.0.0` and `3.0.0`; default constructor poisoning detects unintended fallback.
Stored selection changes preserve the running source until complete Host shutdown and new composition.
Removal restores the actual default version `1.0.0`.

IPC, Open DeskOS Data, cached health, enable preferences, and unrelated Clock preferences remain unchanged across each stage.
Unsigned updates preserve exact configuration bytes and leave the active source unchanged.
Both retained signed revisions pass verification, and their complete captured file maps remain unchanged after removal.
Configured instances each create one controlled MQTT client; unconfigured instances create none.
Shutdown removes owned IPC handlers and closes clients before another source starts.
Released sources ignore late publications and cannot create another client.

The focused Hydra revision, protocol, parity, source composition, Main replacement, native loader, native CLI, and Plugin Host command passed all 104 checks.
Fresh independent review found no actionable selection, consumer, isolation, or ownership issues.
These are added acceptance cases for existing selection behavior; no production behavior changes were required.
That complete command reported 1468 checks: 1465 passed, one failed, and two were skipped.
HTML installation verification timeout leaves the complete gate unresolved.
The cases use parent-owned temporary configuration, state, publisher policy, and controlled MQTT clients without a broker.
Separate Electron processes, actual Main bootstrap, rendered consumers, live broker behavior, Windows, CM5, and physical Hydra acceptance remain unverified.

## Hydra canonical connector capability verification

The [Hydra contract](HYDRA_PLUGIN_CONTRACT.md) defines the public raw connector and retained source behavior.
Main now grants `source.hydra.connect` alongside the existing constructor and options.
`connectHydraMqtt` exports the unchanged canonical SDK connection primitive without constructing a default source.
Independent linked and signed fixtures use this capability without a test-only connection option.
Their protocol state, projections, health, retries, and connection ownership remain independent.

The initial cases failed for the missing connector export and failed independent connections without injected options.
The canonical connector check verifies dependency resolution, canonical loading, and raw client identity without source construction.
The Main wiring check verifies that actual Main composition supplies the same granted primitive.
The focused Hydra, Main wiring, source composition, native loader, native CLI, and Plugin Host command passed all 124 checks.
Fresh independent review found no actionable connector, capability, compatibility, or ownership issues.
These checks use controlled clients and temporary plugin state without broker or physical-device access.

That complete command reported 1470 checks: 1464 passed, three failed, one was cancelled, and two were skipped.
HTML installation, maximum-sized HTML verification, concurrent verification, and Weather rendering failures leave the complete gate unresolved.
Actual Electron replacement bootstrap, rendered consumers, live MQTT, Windows, CM5, and physical Hydra acceptance remain unverified.

## Hydra installed SDK wire verification

The [wire cases](../tests/hydra-mqtt-wire.test.js) exercise default, linked, and signed independent sources through the installed canonical MQTT SDK.
A task-owned TCP endpoint binds only to `127.0.0.1` on an ephemeral port.
The endpoint uses the SDK dependency `mqtt-packet` for actual MQTT packet decoding and encoding.
It acknowledges connection and subscription packets and publishes controlled retained and live measurements.
The sources subscribe to `plants/#` and preserve IPC, Open DeskOS Data, timestamps, units, watering states, and cached health.

Signed execution uses captured verified entry bytes after the stored entry changes.
Independent execution rejects default source construction and uses the public connector without an injected connection option.
Health checks reject ordinary snapshots and require exactly two cached snapshot calls.
Host shutdown closes the SDK connection, removes owned IPC handlers, and closes the endpoint before temporary state removal.
CLI cancellation waits for actual child closure before returning.

The [lifecycle regressions](../tests/hydra-wire-lifecycle.test.js) reproduced a blocked shutdown wait and premature directory removal after endpoint failure.
Cancellation now interrupts the callback wait while cleanup still closes the owned endpoint.
Failed endpoint closure retains temporary state, and cancellation cannot certify successful plugin shutdown.
Fresh independent review found these two test assurance gaps; subsequent read-only review confirmed their repairs without new actionable findings.
The focused wire, lifecycle, Hydra, Main wiring, source composition, native loader, native CLI, and Plugin Host command passed all 129 checks.
The complete command previously reported Pi and Weather rendered-consumer timeouts.
Its process handle and temporary log are absent from the current environment.
Its final totals and exit status remain unverified.

The endpoint is a controlled protocol fixture, not a production broker or a broker conformance suite.
The following bootstrap section records subsequent actual Main and preload evidence.
External MQTT, authentication, TLS, reconnection timing, rendered Hydra consumers, Windows, CM5, and physical Hydra acceptance remain unverified.
CLI cancellation is source-reviewed; an actual cancelled CLI process still needs separate acceptance.

## Hydra actual Main bootstrap verification

The [bootstrap cases](../tests/hydra-main-bootstrap.test.js) execute four distinct actual Main processes through an isolated Electron wrapper.
They start signed version two, updated version three, rollback version two, and the restored default source.
Each process uses actual preload IPC and the canonical installed MQTT SDK.
The parent supplies a task-owned endpoint on `127.0.0.1` with an ephemeral port and controlled live publications.
The wrapper fixes the clock, observes updates, hides its window, and disables unrelated Main factories and packaged content surfaces.

Executed source markers verify each signed revision without default source construction.
Preload snapshots preserve environment values, plant readings, timestamps, watering, online state, and cached health.
Health rejects ordinary source snapshots and requires exactly two cached reads.
Each process makes one MQTT connection and subscribes to the unchanged `plants/#` scope without credentials.
Normal Main shutdown releases Hydra IPC and stops its source.
The parent observes every peer connection close before accepting each process result.

Native CLI operations retain explicit trust and exact grants.
Unsigned candidate mutation preserves exact configuration bytes.
Removal retains both signed revisions, whose captured file maps remain verified and unchanged.
The parent awaits child closure before removing profiles, including rejection paths.

The initial fixture access check failed before the bootstrap wrapper existed.
The focused bootstrap, wire, parity, and revision command passed all 23 checks.
The shared Hydra, Main wiring, source composition, native loader, CLI, and Host command passed all 131 checks.
That complete Shell command reported 1499 checks: 1497 passed, none failed, and two were skipped.
Fresh independent review found no actionable startup, integrity, consumer, or ownership defects.

These results cover local macOS actual Main and preload startup through a controlled MQTT endpoint.
They do not establish external broker behavior, authentication, TLS, reconnect timing, rendered replacement parity, Windows, CM5, or physical Hydra acceptance.
The isolated bootstrap does not establish complete application startup with every service enabled.
Timeout and abort cleanup ordering received source review without separate fault injection.
The selected fixture, constructor rejection, and separate import guard establish source independence.

## Independent Open DeskOS Link source verification

The [Open DeskOS Link contract](ODK_LINK_PLUGIN_CONTRACT.md) defines the raw transport and existing public source methods.
Main grants `source.odk-link.createTransport` alongside the existing client constructor.
The default client uses that transport without changing its endpoint, lazy credential, framing, timeout, or result policies.
The initial transport checks failed before the capability and export existed.

The [independent entry](../tests/fixtures/odk-link-replacement/entry.cjs) owns request lifetime and result projection without Shell imports or default client construction.
The actual CLI loads development links and installs signed bundles with explicit trust and grants.
Signed tests execute captured entry bytes after stored entry mutation.
Shared cases compare snapshots, hosted sessions, machines, event records, unavailable results, and actual Pi consumer behavior.
They preserve reported-event precedence, local fallback, parallel request drain, and independent cancellation.
Owned Unix sockets exercise CJK frames, event IPC, and pending connection closure.

Fresh review found a cancellation gap between transport completion and public method completion.
The regression passed for the default source and failed for linked and signed replacements before repair.
All four replacement methods now recheck cancellation before returning their results.
Fresh follow-up review passed 19 focused checks and found no remaining actionable findings.
The shared Open DeskOS Link, Pi, Main wiring, native loading, CLI, and Host command passed all 285 checks.
That complete Shell command reported 1495 checks: 1493 passed, none failed, and two were skipped.

These results cover local Node on macOS with controlled responses and task-owned Unix sockets.
The token checks inspect transport inputs without proving an actual Windows named-pipe handshake.
The following bootstrap section records subsequent actual Main and preload evidence.
Rendered replacement consumers, external reporters, real Hosted Pi control, Windows, and CM5 remain unverified.

## Open DeskOS Link actual Main bootstrap verification

The [bootstrap cases](../tests/odk-link-main-bootstrap.test.js) use an isolated Electron wrapper that loads the actual Main module.
The parent supplies a task-owned Unix endpoint with controlled machine, snapshot, hosted session, and event responses.
Four distinct processes start signed version two, updated version three, rollback version two, and the restored default.
Each process verifies the executed source revision and uses actual preload IPC for Pi session and event consumers.
Signed processes reject default Open DeskOS Link construction.
Other Main sources remain disabled, and each window remains hidden.

Native CLI operations require explicit trust and the existing source capability grant.
Unsigned candidate mutation preserves exact configuration bytes.
Removal retains both signed revisions, whose captured file maps remain verified and unchanged.
Normal Main shutdown releases Pi handlers and stops Open DeskOS Link.
The parent observes closure of all request connections before accepting each process result.
Child closure precedes private profile removal on success, timeout, or cancellation.

The initial fixture access check failed before the bootstrap wrapper existed.
The focused bootstrap and parity command passed all 17 checks.
The shared bootstrap, Open DeskOS Link, Pi, Main wiring, native loading, CLI, and Host command passed all 286 checks.
Fresh independent review found no actionable findings in bootstrap fidelity, isolation, selection, or resource ownership.
That complete Shell command reported 1496 checks: 1494 passed, none failed, and two were skipped.

These results establish local macOS Main bootstrap with controlled reporters and isolated profiles.
They do not establish rendered surface replacement parity, external reporting services, real Hosted Pi control, Windows, or CM5 acceptance.
The bootstrap disables unrelated Main factories and does not establish complete application startup with all services enabled.
Error, timeout, and abort cleanup paths received source review without separate fault injection.
The checks do not include an Electron descendant-process census.

## Native Open DeskOS Link source acceptance

The existing Open DeskOS Link checks ran on CM5 and macOS with private configuration, state, workspace, endpoints, temporary files, and Electron profiles.
All 25 checks passed on each host without failures or skips.
The test durations were 12182 milliseconds on CM5 and 26521 milliseconds on macOS.
Both commands retained all 673 captured source, test, script, and package inputs unchanged.
No task-owned acceptance process remained on CM5 after completion.

Default, development-linked, and signed sources preserve the shared wire records, Pi consumers, unavailable results, independent cancellation, and request shutdown scenarios.
Owned Unix sockets preserve CJK frames and close pending connections.
Four actual Main processes preserve preload results through signed installation, update, rollback, and default restoration.
The existing CLI rejects unsigned mutation without changing configuration and retains captured revision files after removal.
Main shutdown releases IPC handlers and request connections.
No implementation, fixture deadline, production service, or active release changed.

Run this command from `runtime/shell/` with private host paths:

```sh
node --test --test-concurrency=1 tests/odk-link-plugin-parity.test.js tests/odk-link-transport.test.js tests/odk-link-lifecycle.test.js tests/odk-link-main-bootstrap.test.js
```

These checks use controlled reporters and a parent-owned Unix endpoint.
They do not establish external reporting services, real Hosted Pi control, a Windows named-pipe handshake, or physical input.
The bootstrap disables unrelated Main factories and does not establish complete startup with all services enabled.
Pi presentation retains its separate [view acceptance requirements](#native-pi-app-and-page-acceptance).
This increment follows the user's request to test CM5 first.

## Pi actual Main bootstrap verification

Read [Pi App and page ownership](#pi-app-and-page-ownership) for the current production view composition increment and its affected results.

The [bootstrap scenario](../tests/pi-main-bootstrap.test.js) installs paired independent Pi Sessions and Events through the actual Native CLI.
Its [Electron wrapper](../tests/pi-main-bootstrap.cjs) executes production Main and the actual preload in four separate processes.
Each process owns a private profile, hidden window, and isolated state directory.
A parent-owned Unix endpoint supplies reported sessions, a colliding Hosted Pi session, and recorded events.
The fixture blocks local collectors, SSH execution, and local event inspection.

Installed version `2.0.0`, updated version `3.0.0`, rollback version `2.0.0`, and restored defaults retain complete preload responses.
Execution markers identify captured independent entries; signed startup rejects both default constructors.
Hosted Pi wins the reported identity collision, although its timestamp is older.
Events retain their complete response and truncation flag.
Normal shutdown removes both source handlers, stops all three sources, and closes parent-observed connections.

Unsigned candidates leave configuration bytes unchanged for both identities.
Native store checks verify all four retained signed revisions after selection removal.
The selection helper waits for child closure before cleanup and requires state paths inside its private root.
Parent cancellation and timeout paths use forced termination and await child closure; they do not prove normal plugin shutdown.
Those failure paths have no dedicated fault-injection evidence in this bootstrap scenario.
Electron descendant cleanup has no separate process-tree measurement.

The initial RED command failed because the bootstrap wrapper did not exist.
The focused bootstrap and parity command passed 93 checks without failures or skips.
The shared Pi, Open DeskOS Link, Main selection, native loader, native manager, and Host command passed 203 checks without failures or skips.
The complete Shell command reported 1500 checks: 1498 passed, none failed or cancelled, and two were skipped.
The skips cover Windows-only token refusal and microphone-name encoding.
Fresh read-only review found no actionable startup, provenance, isolation, consumer, or resource ownership defects.

These results do not establish independent Renderer surfaces, external reporters, live SSH, physical input, Windows pipes, or CM5 acceptance.
The separate rendered Pi checks retain their own evidence and limitations.

## Quota actual Main bootstrap verification

The [bootstrap scenario](../tests/quota-main-bootstrap.test.js) installs an independent signed Quota source through the actual Native CLI.
Its [Electron wrapper](../tests/quota-main-bootstrap.cjs) executes production Main and the actual preload in four separate processes.
Each process owns private configuration, native storage, and profile paths.
Controlled configuration resolution and provider requests exclude real account files and services.
Unrelated Main plugins and packaged Renderer surfaces remain disabled.

Installed version `2.0.0`, updated version `3.0.0`, rollback version `2.0.0`, and restored defaults retain complete preload responses.
Five explicit requests cover populated available, empty available, unauthorized, unavailable, and unconfigured results.
Zero and fractional measurements retain their exact values.
Executed entry markers distinguish signed bytes, and signed startup rejects default source construction.
Normal Main shutdown removes the handler and stops the Quota source.

Unsigned updates preserve configuration bytes, and native store checks verify both retained revisions after removal.
Parent cleanup awaits child closure before removing private profiles.
Forced termination handles parent timeout or cancellation; this scenario has no dedicated failure injection or descendant-process census.

The initial RED command failed because the bootstrap wrapper did not exist.
The first implementation failed when automatic Renderer startup refresh consumed an acceptance response.
The repaired fixture waits for Shell initialization and Renderer shutdown before explicit preload requests.
Startup requests receive controlled responses without consuming the five-request acceptance sequence.
The focused bootstrap and parity command passed 22 checks without failures or skips.
Fresh read-only review found no actionable startup, provenance, isolation, consumer, or resource ownership defects.

The shared Quota, provider, Main, native loader, native manager, Host, and reading command passed 95 checks without failures or skips.
The complete Shell command reported 1501 checks: 1499 passed, none failed or cancelled, and two were skipped.
The skips cover Windows-only token refusal and microphone-name encoding.
These results do not establish independent Quota surfaces, real providers, pointer hit testing, physical input, Windows, or CM5 acceptance.
Separate rendered checks retain their own evidence and limitations.

## WeRead actual Main bootstrap verification

The [bootstrap scenario](../tests/weread-main-bootstrap.test.js) installs an independent signed WeRead source through the actual Native CLI.
Its [Electron wrapper](../tests/weread-main-bootstrap.cjs) executes production Main and the actual preload in sixteen separate processes.
Live, empty, error, and unconfigured cases each run installed, updated, rolled-back, and restored default revisions.
Private configuration, native storage, profiles, and cache files remain parent-owned.
Controlled fetch, clock, and random selection prevent real provider access; global fetch rejects uncontrolled requests.

Complete preload responses and cached health remain equal across all four selections in each case.
Executed entry markers identify captured independent source bytes; signed startup rejects default source construction.
Shared public reading and health projection modules remain declared dependencies of the independent source fixture.
Live responses retain English and CJK text, book metadata, cover bytes, and timestamps.
Empty, error, and unconfigured responses retain their complete payloads and health states.

The first live process writes schema version 2 cache data and performs two controlled API requests.
Later live processes perform no notebook or bookmark synchronization and preserve cache bytes through removal and default restoration.
Each live process performs one controlled cover request.
Cached health runs twice with source refresh unavailable and unchanged provider request counts.
Normal shutdown removes the WeRead handler and stops the source.

Unsigned updates preserve configuration bytes, and native store checks verify both retained signed revisions after removal.
The selection helper requires state paths inside its private root and passes cancellation to owned CLI processes.
Parent cleanup waits for child closure before deleting profiles and the shared cache.
Timeout and cancellation paths use forced termination; this bootstrap has no dedicated failure injection or descendant-process census.

The initial RED command failed because the bootstrap wrapper did not exist.
The focused bootstrap, parity, and revision command passed 45 checks without failures or skips.
The shared WeRead, health, Main, native loader, native manager, Host, and reading command passed 107 checks without failures or skips.
Fresh read-only review found no actionable startup, provenance, isolation, cache, health, or ownership defects.
The complete Shell command reported 1505 checks: 1503 passed, none failed or cancelled, and two were skipped.
The skips cover Windows-only token refusal and microphone-name encoding.

These results do not establish independent surfaces, real providers, image decoding, physical input, Windows, or CM5 acceptance.
Separate rendered checks retain their own image-decoding, interaction, and geometry evidence.

## Weather surface release repair

The [registry regressions](../tests/weather-surface-lifecycle.test.js) reproduced late successful and rejected IPC responses changing an already released Weather element.
They also reproduced a released cached request starting its chained forced refresh and crossing a later enable operation.
All five controlled regressions failed before the repair.
These failures describe an existing default surface defect, separate from independent replacement compatibility.
They resolve requests after completed release; release-initiation races are not covered by this fixture.

The [Weather surface](../src/renderer/plugins/weather.js) now registers a scoped release guard before starting requests.
Rendering, refresh entry, and tick callbacks check that guard and the factory signal.
Released responses cannot write DOM state or start a chained forced request.
Enable restores a fresh mount while earlier responses remain isolated.
The Renderer does not cancel shared Main Weather acquisition; source ownership remains unchanged.

The shared surface, rendered Weather, Renderer Host, and runtime-controller command passed 71 checks without failures or skips.
Existing rendered Weather checks retain their three-theme, two-size, and six-state evidence.
The complete Shell command reported 1510 checks: 1508 passed, none failed or cancelled, and two Windows-only checks were skipped.
Isolated Widget/App style checks passed, and density checks passed five resolutions with zero violations.
Fresh read-only review found no actionable release, continuation, or restoration defects.

The aggregate E2E command passed with zero driver, motion, and sweep failures.
All interior, sequential, Hydra composition, six density, and seven theme subprocesses returned success.

A design hook misclassified a Montserrat test regular expression as an unsupported font declaration.
DESIGN.md already declares Montserrat, so a precise value ignore records this false positive.
No font or visual style changed.

This repair does not establish independent Weather surface replacement, real provider compatibility, physical input, or supported-device acceptance.
Independent surface implementation remains the next Weather replacement gate.

## Independent Weather surface verification

The [independent browser entry](../tests/fixtures/weather-surface-replacement/entry.js) owns display state, refresh sequencing, shared tick cadence, and release guards.
It shares static layout, sky artwork, and a byte-checked Weather stylesheet snapshot with the default visual contract.
It imports no default mount function and does not acquire provider data itself.
The [surface contract](WEATHER_SURFACE_PLUGIN_CONTRACT.md) defines these boundaries and acceptance limits.

The [shared registry checks](../tests/weather-surface-lifecycle.test.js) exercise default and independent definitions through actual Renderer Host lifecycle APIs.
They compare waiting, live, stale, unavailable, unconfigured, malformed, falsy, and extreme English/CJK display inputs.
They preserve cached-before-forced requests and every-fifth-tick refresh behavior.
Active cached and forced rejections retain unavailable fallback and later recovery.
Release snapshots include SVG attributes and markup, text, state, and titles.
Old responses and stale tick callbacks cannot affect released or restored surfaces.

The [Electron scenario](../tests/weather-surface-electron.test.js) links the replacement with the actual trusted CLI and private configuration.
Authenticated discovery, actual preload, and the browser loader select the independent definition before registry mount.
A throwing default mount and an executed surface marker distinguish actual replacement behavior from manifest selection.
Six scenarios across three themes and two sizes retain complete text, glyph markup, fonts, readable minimums, and contained positive geometry.
The independent surface also consumes the separately signed independent Main source.
The unchanged default fixture path retains separate source-replacement acceptance.

The initial shared RED command passed five default release scenarios and failed five missing independent-entry scenarios.
Fresh review found falsy-response and display-exception differences in the first independent entry.
Additional regressions reproduced each difference before its repair.
The repaired entry matches default waiting and unavailable fallback behavior without detached render-error rejections.
Review also expanded SVG release snapshots and active request rejection coverage.
Subsequent read-only review found no remaining actionable defects.

The final shared surface, Weather consumer, development loader, and Renderer Host command passed 86 checks without failures or skips.
The complete Shell command reported 1521 checks: 1519 passed, none failed or cancelled, and two Windows-only checks were skipped.
Styles regenerated successfully; isolated packaged Widget/App style checks and five-resolution density checks passed with zero violations.
These results do not establish signed surface revisions, separate-process surface selection, screenshot pixel equality, or independent density acceptance.
They do not establish real providers, physical input, Windows, or CM5 acceptance.

Later shared density checks completed on 2026-10-10 through the same Weather browser fixture.
The default and selected surfaces use the existing collector and one shared Weather density profile without changed limits.
All six sampled states across Instrument, Pixel, Border Beam, and five standard viewport sizes satisfy those limits without clipping.
Fill, occupied area, and empty-band measurements match between default and selected surfaces.
Development and signed loading paths retain their default construction guards and actual preload consumers.
The affected command passed twelve tests with zero failures or skips in 88097 milliseconds after expansion to all five standard sizes.
It includes source and surface signed update, rollback, removal, and separate-process consumers.
The default density entry also passed all five standard sizes with zero violations after the shared profile extraction.
No production source changed; the earlier private candidate predates these eight test input changes.
Screenshot pixel equality, real providers, and supported-device acceptance remain unverified.

```sh
node --test --test-concurrency=1 tests/weather-electron.test.js tests/weather-restart-electron.test.js tests/weather-surface-electron.test.js tests/weather-surface-restart.test.js tests/widget-density.test.js tests/widget-density-metrics.test.js
```

## Signed Weather surface captured assets

The [surface Electron check](../tests/weather-surface-electron.test.js) now also selects a signed independent Weather surface through the actual Native CLI.
The [signed helper](../tests/helpers/weather-surface-selection.js) supplies temporary publisher policy and explicit trust for the permission-free Renderer declaration.
Its private state directory shares the fixture root.
The parent prepares signed sources, development links, and signed surfaces before Electron starts.
Each CLI command receives test cancellation and a ten-second timeout, and waits for child closure.
The Electron fixture refuses nested CLI launches before it imports selection helpers.
The separately signed Main source retains its own explicit publisher policy.
This setup does not establish one deployed publisher policy for both selections.

Actual native Renderer discovery captures verified entry and stylesheet bytes before browser loading.
The fixture then changes both stored files.
A repeated native store snapshot rejects the modified revision, while captured asset responses retain the original signed content.
Actual Renderer discovery, browser loading, registry selection, and preload consumers still retain the complete Weather rendered matrix.
The throwing default mount and executed marker continue to identify the independent implementation.
The matrix compares six states across three themes and two sizes.

Discovery shutdown removes the signed asset protocol handler.
An actual preload discovery request rejects after the IPC handler is removed.
Closing the original asset snapshot makes its routes return status `410`.
The parent waits for the Electron child to close before deleting private profiles, configuration, and revisions.
A controlled command cancellation waits for the actual child to close and verifies that its process identifier no longer exists.
This check uses the shared command owner, not an interrupted Native installation.
Forced Electron termination and interrupted Native installation remain outside dedicated fault injection.

The initial RED command passed development loading and failed the missing signed-loading report.
The first focused source, surface, and lifecycle command passed 18 checks without failures or skips.
Fresh review found nested CLI ownership defects in signed and development preparation.
Both preparation paths now run in the parent.
The refusal regression first failed both surface modes, then passed with the parent preparation and Electron guard.
The focused source, surface, revision, lifecycle, and command-owner checks passed 24 tests.
Four command-owner checks passed separately, including actual child cancellation.
Fresh follow-up review found no remaining actionable defects in the ownership repair.
The refusal guard covers `execFile`; it does not prohibit every subprocess API.
The complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,522 tests with two Windows-only skips and no failures.
The command completed in 65.50 seconds from `runtime/shell/`.

These results do not establish surface update, rollback, removal, separate-process startup, runtime replacement, independent density, or screenshot pixel equality.
Real provider, physical input, Windows, and CM5 acceptance remain separate.

## Weather surface signed revision and separate process verification

The [revision check](../tests/weather-surface-restart.test.js) uses actual Native CLI install, update, rollback, and removal commands.
Four different Electron processes execute surface revisions `2.0.0`, `3.0.0`, restored `2.0.0`, and default `1.0.0`.
The signed independent Main source remains selected in every process.
Actual Renderer discovery, browser loading, registry, and preload consumers retain six states across three themes and two sizes.
Manifest versions and executed entry markers identify the selected independent surface.
A throwing default mount refuses unintended default execution while an independent entry is selected.

Both source and surface loaders read one external publisher policy through environment configuration.
Publisher permissions remain separated by identity and host.
The fixture uses controlled Main composition; it does not establish paired production `src/main.js` startup.
Each CLI command and Electron consumer belongs to the parent, receives cancellation, and waits for child closure before private state removal.

Unsigned candidate changes fail without configuration changes.
Update, rollback, and removal preserve source selection, surface enable preference, and an unrelated disabled Clock preference.
Original source and surface stored snapshots retain their verified bytes after every process closes.
These revision checks omit stored-file mutation; the separate captured-asset check retains that coverage.

The first process writes persistent Weather cache.
Subsequent processes read that cache before provider acquisition, preserve its readings during controlled provider failure, and leave its bytes unchanged.
The initial added cache assertion expected live status and failed.
Both source implementations already load cached readings as stale, so the assertion now retains that existing behavior.
No production source behavior changed.

The initial RED revision check failed because the fixture had no independent signed candidate builder.
Four focused rendering checks passed after implementation.
The shared rendering, source restart, surface lifecycle, native asset, and revision-manager command passed 33 tests without failures or skips.
Independent follow-up review found no remaining actionable defects.
The complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,523 tests with two Windows-only skips and no failures.
It completed in 65.56 seconds from `runtime/shell/`.

Runtime hot replacement, independent density, screenshot pixel equality, real providers, physical input, Windows, and CM5 remain unverified.

## Weather actual Main joint source and surface startup

The [joint startup check](../tests/weather-main-surface.test.js) installs signed independent source and surface selections through the Native CLI.
One external publisher policy authorizes separate Main and Renderer identities.
The [bootstrap wrapper](../tests/weather-main-bootstrap.cjs) requires production `src/main.js` without smoke mode.
It controls provider responses, window visibility, and unrelated disabled features.
Production discovery, loaders, Host composition, preload, Renderer loading, and registry selection remain active.

Four different Electron processes execute surface install, update, rollback, and removal with the signed source unchanged.
Actual discovery returns the selected surface identity, manifest version, entry URL, and stylesheet URL.
Catalog versions and executed entry markers agree with revisions `2.0.0`, `3.0.0`, restored `2.0.0`, and default `1.0.0`.
The default source constructor and default surface mount refuse unintended execution while their independent replacements are selected.
Live readings retain place, temperature, unit, condition, and daily range through actual preload and rendered consumers.
Source preference and original signed source and surface snapshots remain unchanged.

Normal production quit stops the Weather and Renderer discovery plugins.
It removes both IPC handlers and the signed asset protocol handler.
Parent cancellation uses bounded execution and waits for child closure before deleting private profiles.
The existing source bootstrap fixture now uses the same cancellation and child-close ownership.

The initial RED check failed because the bootstrap report had no surface execution evidence.
The shared native asset, Main bootstrap, rendered surface, and separate-process revision command passed 11 checks without failures or skips.
Independent follow-up review found no remaining actionable defects.
The complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,524 tests with two Windows-only skips and no failures.
It completed in 67.32 seconds from `runtime/shell/`.

This joint startup check covers controlled live readings, not the broader rendered state matrix or persistent cache contract.
The separate surface revision fixture owns those scenarios.
Real providers, other active features, physical input, Windows, CM5, and full-process cancellation fault injection remain unverified.

## Independent WeRead surface verification

The [independent entry](../tests/fixtures/weread-surface-replacement/entry.js) owns rendering, fitting, decoding, keyboard scrolling, ticks, and resource release.
It shares static HTML layout, stylesheet bytes, semantic tokens, and fonts without importing the default mount.
The [surface contract](WEREAD_SURFACE_PLUGIN_CONTRACT.md) owns preserved behavior and acceptance limits.

The [shared tile checks](../tests/weread-tile.test.js) now exercise both implementations through the actual registry and Host.
Reading success and rejection, superseded images, stale callbacks, failed observer cleanup, and new mounts retain resource ownership.
Fitting retains the existing row gap, shrink steps, fourteen-pixel floor, and scroll-key ownership.

The [Electron check](../tests/weread-surface-electron.test.js) uses actual trusted development linking and Renderer discovery.
Parent-owned CLI preparation receives cancellation, bounded execution, and child-close ownership before private state deletion.
The surface consumes a separately signed independent source through actual sandboxed preload.
A throwing default mount and executed surface marker identify independent execution.
Rendered state, metadata, font, cover pixel, aspect ratio, and geometry comparisons cover three themes and two sizes.

Independent review found that the initial short excerpt could skip conditional keyboard acceptance.
The surface fixture now forces long English/CJK overflow in every theme and size.
Actual End/Home input checks the final character, focus retention, and unchanged page ownership for both implementations.
Follow-up review found no remaining actionable defect.

The initial shared RED command passed default behavior and failed missing independent-entry cases.
The final tile, surface, rendered source, source parity, and revision command passed 76 tests without failures or skips.
Isolated packaged Widget/App style checks passed.
Packaged density checks passed all five standard sizes without violations.
Those density results cover default packaged surfaces, not the independent WeRead entry.
The complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,542 tests with two Windows-only skips and no failures.
It completed in 70.47 seconds from `runtime/shell/`.

These checks do not establish signed surface revisions, joint production Main startup, independent density, or whole-Widget screenshot equality.
Real providers, physical input, assistive technology, Windows, and CM5 remain unverified.

Later shared density checks completed on 2026-10-10 in the existing WeRead browser fixture.
Its complete state and keyboard comparisons now cover five standard sizes across three themes.
The short density scenario uses the existing shared excerpt and title without optional metadata or a cover.
Default and selected surfaces satisfy the unchanged WeRead profile with matching fill, occupied area, and empty-band measurements.
The separate long-excerpt scenarios preserve covers, metadata, decoded pixels, actual End/Home input, and final-character access.
The six-file browser and density command passed twelve tests with zero failures or skips in 119902 milliseconds.
It covers development and signed surfaces plus source and surface updates, rollback, removal, and separate-process consumers.
The tile, source parity, and revision command separately passed 74 tests with zero failures or skips in 10425 milliseconds.
The default density entry passed five standard sizes with zero violations after the shared profile extraction.
An initial full-metadata density input required scrolling at `480x854` in the default implementation; no layout change was made.
Expanding the long-excerpt report exceeded its one-MiB capture limit; the surface parent now uses the source parent's existing four-MiB limit.
No production source changed; the earlier private candidate predates these WeRead test changes.
Density with covers and optional metadata, screenshot equality, real providers, and supported-device acceptance remain unverified.

```sh
node --test --test-concurrency=1 tests/weread-electron.test.js tests/weread-restart-electron.test.js tests/weread-surface-electron.test.js tests/weread-surface-restart.test.js tests/widget-density.test.js tests/widget-density-metrics.test.js
node --test --test-concurrency=1 tests/weread-tile.test.js tests/weread-plugin-parity.test.js tests/weread-revision.test.js
```

## Signed WeRead surface captured asset verification

The [surface Electron check](../tests/weread-surface-electron.test.js) now covers trusted development and signed Native surface discovery.
The [signed helper](../tests/helpers/weread-surface-selection.js) signs entry, manifest, and stylesheet bytes with a publisher restricted to the surface identity and Renderer host.
The actual Native CLI requires explicit trust; the surface receives no capability grants.
The parent prepares both selections with cancellation, bounded CLI execution, and child-close ownership.
The controlled Main source and Renderer surface loaders retain separate publisher policies.

Native Renderer discovery captures verified entry and CSS bytes.
The fixture changes both stored files before actual browser loading.
Captured asset responses retain the original signed content; another store snapshot rejects the modified revision.
Actual registry and preload consumers retain the long-excerpt state, cover pixel, metadata, geometry, and keyboard matrix across three themes and two sizes.
The throwing default mount and executed marker identify independent surface execution.

Discovery shutdown removes its protocol handler and IPC handler.
An actual preload discovery request reports the removed handler.
Closing the original asset snapshot makes its routes return status `410`.
Independent read-only review found no remaining actionable defect.

The RED command passed development loading and failed absent Native discovery.
The shared surface, rendered source, tile lifecycle, and native asset command passed 42 tests without failures or skips.
The complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,543 tests with two Windows-only skips and no failures.
It completed in 75.27 seconds from `runtime/shell/`.

Signed surface update, rollback, removal, process restart, joint production Main startup, independent density, and whole-Widget screenshot equality remain unverified.
Real providers, full-process cancellation fault injection, physical input, assistive technology, Windows, and CM5 remain unverified.

## WeRead surface revision and joint Main acceptance

The [revision check](../tests/weread-surface-restart.test.js) exercises actual Native update, rollback, removal, and four separate Electron processes.
Signed source and surface loading share one external publisher policy.
Executed surface markers identify versions `2.0.0`, `3.0.0`, `2.0.0`, and default `1.0.0`.
Rendered matrices retain excerpts, metadata, decoded covers, and keyboard scrolling across three themes and two sizes.
Invalid updates retain configuration; source selection, unrelated preferences, and stored revisions remain unchanged.

The first default source baseline primes a retained cache before the signed source checkpoint.
Later processes supply no API key and make no provider requests while retaining highlight values and cache bytes.
The initial large report exposed stdout truncation before Electron exit.
The repaired child waits for its complete write instead of reducing the consumer matrix.
An initial counter expectation incorrectly required another request from the already cached signed checkpoint.
Separate priming and checkpoint counters now verify actual request ownership.
The repaired shared revision, rendered source, surface, Native asset, and tile command passed 45 checks without failures or skips.

The [joint Main check](../tests/weread-main-surface.test.js) executes actual `src/main.js` with both signed selections and one external publisher policy.
Four separate processes preserve preload values and mounted excerpt, title, author, date, and absent-cover behavior across surface transitions.
Later processes retain the cache without API credentials or API requests.
Normal shutdown releases source and discovery IPC handlers and signed asset routes.
The initial RED check failed because the bootstrap wrapper omitted surface acceptance.
The extended wrapper retains the original live, empty, error, and unconfigured source scenarios.
The joint bootstrap, rendered surface, and surface revision command passed eight checks without failures or skips.
Independent review identified missing child-PID binding and a direct date expectation.
The parent now binds reported identity to the spawned child and waits for closure before profile deletion.
The wrapper checks rendered date against the controlled preload timestamp.
The repaired bootstrap command passed five checks without failures or skips.
Independent follow-up review found no remaining actionable defect.
The complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,545 tests with two Windows-only skips and no failures.
It completed in 88.44 seconds from `runtime/shell/` after the review repairs.
JavaScript syntax, local document references, new descriptive sentence bounds, and `git diff --check` passed.
Sentence bounds alone do not certify full STE dictionary or word-meaning conformance.

This joint check uses private state, disabled unrelated factories, controlled providers, one size, and the startup theme.
Independent density, real providers, full-process cancellation, assistive technology, physical input, Windows, and CM5 remain unverified.

## Hydra surface release isolation repair

The default Hydra surface previously allowed pending source responses and queued resize callbacks to change released elements.
The [regression checks](../tests/hydra-surface-lifecycle.test.js) reproduce late success, late rejection, queued resize, and failed observer release.
All four checks failed before the repair through the actual Renderer registry and Host.

Each mount now owns a release flag and checks its factory signal before rendering, fitting, refreshing, or processing ticks.
Release prevents old source responses from changing a new mount on the same element.
Old ticks cannot request source data, and queued resize callbacks cannot change shape or labels.
Failed observer disconnection remains owned and retryable through the existing registry cleanup contract.
Active reading formats, layout thresholds, refresh cadence, and Main source ownership remain unchanged.

The affected surface, source parity, and actual Main bootstrap command passed 20 checks without failures or skips.
JavaScript syntax and `git diff --check` passed.
The first full command found one compatibility failure in an existing direct-mount fixture without `trackCleanup`.
The repair preserves optional cleanup registration, matching the previous observer registration contract.
Actual registry mounts supply cleanup registration and retain the release guard.
The final complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,549 tests with two Windows-only skips and no failures.
It completed in 93.34 seconds from `runtime/shell/`.
The affected lifecycle and sequential refinement command passed 16 checks without failures or skips.
Independent read-only review and compatibility follow-up found no blocking correctness defect in the release guards.
The DOM model retains selector nodes across remounts; real browser remount behavior remains unverified.
These checks do not exercise Main consumers or the interval before surface cleanup begins.
Failed disconnection retries are covered; refusal to remount retained elements belongs to the existing registry checks.
This repair removes a default lifecycle defect before independent Hydra surface acceptance.
It does not establish an independent surface, rendered replacement parity, real broker behavior, or supported-device acceptance.

## Independent Hydra surface fixture acceptance

The [independent entry](../tests/fixtures/hydra-surface-replacement/entry.js) shares static HTML and Shell CSS without calling the default mount.
It owns telemetry formatting, measured Cell composition, badges, plant meters, refresh cadence, and resource release.
[The surface contract](HYDRA_SURFACE_PLUGIN_CONTRACT.md) owns preserved behavior and acceptance boundaries.

The [shared checks](../tests/hydra-surface-lifecycle.test.js) select both factories through actual registry and Host composition.
A throwing default mount prevents accidental default execution in independent cases.
The RED command passed default behavior and failed missing independent entries.
An initial comparison incorrectly treated DOM-model query insertion order as a display difference.
Snapshots now sort selector identities and class names while preserving all values, styles, states, and shape results.
Nine source states cover four measured Cell shapes.
Same-instance transitions cover stale, offline, unconfigured, and live recovery with reverse shape changes.
Late reading success, rejection, queued resize, tick cadence, active IPC recovery, and observer cleanup retry remain shared scenarios.

Independent review found no behavior mismatch but identified missing recovery sequences and DOM-model limitations.
Recovery sequences are now explicit shared scenarios.
Independent follow-up review found no remaining actionable defect.
The final complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,560 tests with two Windows-only skips and no failures.
It completed in 94.53 seconds from `runtime/shell/`.
The affected surface, source parity, actual Main bootstrap, and sequential refinement command passed 43 checks without failures or skips.
JavaScript syntax, local document references, new descriptive sentence bounds, and `git diff --check` passed.
Sentence bounds do not certify full STE dictionary or word-meaning conformance.
The model retains nodes across remounts and separates `className` from `classList`.
Actual browser classes, real DOM remounts, development discovery, signed revision transitions, and preload rendering remain unverified.
Independent density, real brokers, assistive technology, physical input, Windows, and CM5 remain unverified.

## Hydra trusted development surface rendering

The [Electron check](../tests/hydra-surface-electron.test.js) links the independent surface through the actual CLI with explicit trust.
Actual Renderer discovery selects version `2.0.0` before Shell composition.
A throwing default mount prevents unintended default execution.
The browser uses actual sandboxed preload and controlled Hydra IPC without starting a live source or broker.
Private parent-owned profiles, configuration, and state receive cancellation, bounded commands, and child-close cleanup.

Eight source states across three themes and ten Cells produce 240 default-versus-independent comparisons.
Host and descendant snapshots include attributes, all computed CSS properties, text, and relative geometry.
Containment, absence of controls, and data and caption floors remain explicit checks.
Temporary surfaces release through the registry before removal; discovery shutdown makes its actual preload endpoint unavailable.

The first RED command could not launch the absent Electron fixture and reached its bounded parent timeout.
A fixture access check now prevents that missing-file delay.
The first rendered command exposed narrow default `Waiting` badge overflow.
Header wrapping then exposed insufficient plants-only space for the stale badge and omission count.
The measured fixture also required its own resolved Widget inset instead of the desktop Cell's inherited value.
Shared Hydra styles now wrap headers, tighten narrow gaps, and use twelve-pixel plants-only padding.
The repaired rendered command passed all 240 comparisons.
The rendered, shared lifecycle, and actual Main source bootstrap command passed 17 checks without failures or skips.

Independent review identified missing style and host-attribute coverage; snapshots now include both without reducing comparison scope.
Independent follow-up review found no remaining actionable defect.
The complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,561 tests with two Windows-only skips and no failures.
It completed in 119.96 seconds from `runtime/shell/`.
Styles regenerated without a generated CSS change.
All six geometry harnesses ran in separate private Electron profiles with bounded execution and child-close cleanup.
The responsive matrix passed 30 runs without violations; density passed five sizes without violations.
Pi passed 36 style cases; Futu passed twelve contract cases, nine geometry cases, and six captions.
Hydra passed thirty composition cases and ten unconfigured cases; Widget/App styles passed.
Those geometry and density results cover default packaged composition, not independent density acceptance.
JavaScript syntax, local document references, new descriptive sentence bounds, and `git diff --check` passed.
The rendered gate remounts each state and does not establish same-instance browser recovery or initial unconfigured request timing.
Shared model checks cover narrower transition behavior.
Signed surface revisions, joint source/surface startup, independent density, real brokers, assistive technology, physical input, Windows, and CM5 remain unverified.

## Signed Hydra surface captured entry acceptance

The [Electron check](../tests/hydra-surface-electron.test.js) now covers development and signed Native surface loading.
The [helper](../tests/helpers/hydra-surface-selection.js) signs manifest and entry bytes with an identity-and-host-scoped Ed25519 publisher.
The actual Native CLI requires explicit trust; the surface declares no permissions and receives no capability grants.
Its external public keyring feeds the production Renderer loader.
Packaged Shell styles remain shared without a signed external stylesheet.

Native discovery captures the verified entry before actual browser loading.
The fixture then overwrites the stored entry.
Captured responses retain the signed bytes, while another store snapshot rejects the changed revision.
The throwing default mount prevents fallback or delegation from passing independent acceptance.
Each mode retains the complete 240-case actual preload, attribute, computed-style, text, geometry, and readable-floor matrix.

The discovery Host binds a separate captured asset lease.
Shutdown removes discovery IPC and its protocol handler.
An actual preload discovery request then rejects; closing the original asset snapshot makes its entry route return status `410`.
CLI preparation receives cancellation, bounded execution, and child-close cleanup before parent-owned state deletion.
Independent read-only review found no actionable defect.

The RED command passed development loading and failed the absent Native preparation helper.
The repaired focused command passed development and Native modes without failures or skips.
The shared rendered surface, lifecycle, and Native asset command passed 23 checks without failures or skips.
The complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,562 tests with two Windows-only skips and no failures.
It completed in 122.57 seconds from `runtime/shell/`.
JavaScript syntax, local document references, new descriptive sentence bounds, and `git diff --check` passed.
Sentence bounds alone do not establish full STE dictionary or word-meaning conformance.
Signed surface update, rollback, removal, process restart, joint production Main startup, and independent density remain unverified.
Live brokers, full-process cancellation faults, assistive technology, physical input, Windows, and CM5 remain unverified.

## Hydra signed surface revision process acceptance

The [revision check](../tests/hydra-surface-restart.test.js) uses actual Native update, rollback, removal, and four separate Electron processes.
One external publisher policy retains signed Main source and Renderer surface selections.
Executed entry markers identify surface versions `2.0.0`, `3.0.0`, `2.0.0`, and default `1.0.0`.
Reported PIDs match actual child identities.
Every process compares all 240 rendered cases with its default baseline.
Full consumer files retain all attributes, computed CSS, text, and geometry for byte comparisons across launches.

Invalid updates preserve configuration bytes.
The source selection, unrelated Clock preference, enabled surface preference, and all stored snapshots remain unchanged.
Revision capture preserves stored bytes; the separate signed-entry check retains mutation acceptance.
CLI preparation receives cancellation and ten-second timeouts.
The parent waits for Electron closure before deleting each profile and its full consumer export.

The RED command failed absent process-revision evidence after the existing rendered matrix passed.
The first cross-process attempt found unstable browser CSS custom-property enumeration order.
An attempted large assertion diagnostic also raised `Invalid array length`.
Snapshots now sort property names while retaining every value.
Full Buffer comparisons retain all consumer bytes; mismatch diagnostics show only the first difference and nearby content.
Independent review and follow-up found no material defect in process ownership, selection, retention, or full comparison logic.
The repaired separate-process command passed its four launches without failures or skips in 94.28 seconds.
The complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,563 tests with two Windows-only skips and no failures.
It completed in 134.12 seconds from `runtime/shell/`.
JavaScript syntax, local document references, new descriptive sentence bounds, and `git diff --check` passed.
Sentence bounds alone do not certify full STE dictionary or word-meaning conformance.

This fixture retains source selection without executing that source factory.
Joint actual Main source/surface startup, independent density, live brokers, assistive technology, physical input, Windows, and CM5 remain unverified.
Full-process cancellation fault injection remains unverified.

## Hydra joint Main source and surface acceptance

The [joint check](../tests/hydra-main-surface.test.js) starts the production Main module with signed independent source and surface selections.
One external publisher policy binds both entries.
Four separate Electron processes execute surface revisions `2.0.0`, `3.0.0`, `2.0.0`, and default `1.0.0`.
The signed source retains revision `2.0.0`; unintended default source construction or surface delegation fails.
Actual child PIDs and surface entry markers identify execution.

A private loopback broker supplies canonical MQTT packets through the installed SDK, production source, actual preload, and mounted Widget.
Assertions check environmental values, units, Live state, soil percentage, watering state, and meter fill.
Complete descendant attributes and leaf text remain equal across all launches.
The separate 240-case rendered matrix owns broader state, theme, computed-style, and geometry evidence.

Invalid updates preserve configuration bytes.
Surface transitions retain source selection and all stored source and surface bytes.
Shutdown releases source IPC, discovery IPC, signed asset routes, and broker sockets.
Parent cleanup awaits child closure before deleting its private profile.
Unrelated sources and surfaces remain disabled; no broker credentials or external endpoint are used.

The RED command failed because the original bootstrap reported no selected surface rendering.
The repaired focused command passed all four launches.
The shared Main bootstrap, source revision, MQTT wire, and fixture lifecycle command passed 13 checks without failures or skips.
Independent read-only review found no material defect in execution, trust, consumer fidelity, or cleanup ownership.
The complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,564 tests with two Windows-only skips and no failures.
It completed in 145.97 seconds from `runtime/shell/`.
JavaScript syntax, local document references, new descriptive sentence bounds, and `git diff --check` passed.
Sentence bounds alone do not certify full STE dictionary or word-meaning conformance.
Renderer runtime stop is requested before quitting.
Automatic Renderer shutdown and observer leak measurement remain outside this joint check.
Runtime hot replacement, independent density, external brokers, full-process cancellation faults, assistive technology, physical input, Windows, and CM5 remain unverified.

## Trusted Host runtime replacement acceptance

The [runtime contract](RUNTIME_PLUGIN_REPLACEMENT.md) owns the new trusted in-memory Host replacement interface and its remaining integration gates.
Fourteen Host scenarios check release order, declaration refusal, rollback, retained cleanup, concurrent requests, shutdown, disabled selections, and declaration snapshots.
The Hydra scenario checks actual signed source capture, controlled production IPC handlers, Open DeskOS Data, cached health, and MQTT completion ownership.
It replaces signed source `2.0.0` with `3.0.0` and restores default behavior inside one Host.
It does not render a Widget or use an actual MQTT broker.

The first RED command failed all nine initial scenarios because the Host had no replacement method.
Independent review found a queued enable allocation after shutdown interrupted replacement.
A deterministic regression failed with two factory constructions instead of one.
Capturing enable request generation before queuing prevents this allocation while retaining later startup preferences.
The repaired shared Host, Renderer lifecycle, Hydra runtime, and Hydra source parity command passed 95 checks without failures or skips.
Independent follow-up review confirmed the shutdown correction and found no additional material defect.
Personal Bot passed 587 tests with two skips and no failures in 43.92 seconds.
Its TypeScript check also passed.
Remote Bridge initially had two socket-listen failures under the long macOS temporary path.
Using a short temporary root, `env TMPDIR=/tmp node --test integrations/remote-bridge/test/*.test.js`, passed all 65 checks in 1.36 seconds.
No production endpoint or live peripheral was used.
The complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,579 tests with two Windows-only skips and no failures.
It completed in 142.70 seconds from `runtime/shell/`.
JavaScript syntax, local document references, new descriptive sentence bounds, and `git diff --check` passed.
Sentence bounds alone do not certify full STE dictionary or word-meaning conformance.

## Renderer programmatic runtime replacement acceptance

The [runtime contract](RUNTIME_PLUGIN_REPLACEMENT.md#renderer-programmatic-replacement) owns the Renderer replacement interface, ownership rules, and remaining loading gates.
Twelve new registry scenarios exercise retained placement context, dependent ports, isolated peers, contract refusal, cleanup retry, rollback, App protection, serialization, and shutdown.
Two controller scenarios check replacement reconciliation and refusal publication.
A Host inspection scenario checks copied metadata and factory identity without execution.

The initial RED command failed because the registry had no replacement method.
An existing optional-consumer scenario then detected a brief external App mount opportunity after queue entry.
Queued transition reservations now refuse external mounts immediately while private restoration retains request order.
A further RED scenario showed that controller shutdown allowed candidate creation after delayed unmount completion.
Controller stop now closes registry management immediately and then drains queued publication work.
Independent review found mutable caller definitions could change styles or identity after admission.
A deterministic RED scenario changed those values before and during old-surface release.
Admission now copies declaration, identity, factory, lifecycle functions, and stylesheet binding before queuing.
The repaired shared Host, registry, and controller command passed 94 checks without failures or skips.
Independent follow-up review confirmed the admission correction and found no additional material defect.
Personal Bot passed 587 tests with two skips and no failures in 45.86 seconds.
Its TypeScript check also passed.
Remote Bridge passed all 65 checks with a short temporary root in 1.04 seconds.
The final complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,594 tests with two Windows-only skips and no failures.
It completed in 138.98 seconds from `runtime/shell/` after the admission correction.
JavaScript syntax, local document references, new descriptive sentence bounds, and `git diff --check` passed.
Sentence bounds alone do not certify full STE dictionary or word-meaning conformance.

These checks use modeled containers and the actual registry and common Host.
They do not establish actual browser runtime replacement, pixel parity, signed asset replacement, authenticated operator commands, or supported-device acceptance.

## Hydra actual browser runtime replacement acceptance

The [runtime contract](RUNTIME_PLUGIN_REPLACEMENT.md#browser-entry-loading-and-live-native-leases) owns runtime entry loading, serialized collection, unchanged stylesheets, and explicit Main live-asset capability boundaries.
Three browser-loader scenarios verify runtime selection, pre-execution refusal, concurrent collection, and recovery after rejection.
Two Native asset scenarios verify read-only live publication, snapshot isolation, closure authority, and authenticated discovery without handler replacement.
The shared Native asset, browser loading, registry, and controller command passed 78 checks without failures or skips.

The Hydra development runtime command passed its unchanged-document matrix in 35.14 seconds.
The first signed runtime command failed because its existing document could not fetch a newly registered Native protocol route.
A separate fetch assertion reproduced that failure before entry loading.
An explicit live asset lease now binds the route before document loading and serves later verified captures without restarting discovery.
The repaired signed runtime command passed in 33.31 seconds.

The actual sandboxed preload and runtime controller replace default, independent, and restored-default definitions in the same desktop container.
Every phase captures all 240 theme, Cell, and controlled source-state consumers.
Two replacement phases retain 480 full comparisons of attributes, computed CSS, text, and geometry against default behavior.
Stored signed-entry mutation cannot change captured execution.
Default delegation throws, while restored default mounting executes through its captured counter.
Independent read-only review found no material defect in admission, loading, leases, or discovery authority.
The complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,601 tests with two Windows-only skips and no failures.
It completed in 155.28 seconds from `runtime/shell/`.

This fixture uses controlled Hydra IPC without constructing its MQTT source factory.
Production Main runtime publication, authenticated operator activation, stylesheet replacement, per-revision retirement, external providers, and supported-device acceptance remain unverified.


## Authenticated signed Main activation acceptance

The [runtime contract](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-signed-main-activation) owns current signed Main activation, receipts, authorization, and remaining integration limits.
The initial RED command failed all 14 activation checks because the activation module did not exist.
Eighteen repaired activation checks cover current selections, immutable captures, consumer recreation, authorization refusal, cancellation, concurrent disable, recovery, and channel authentication.
Candidate failure reports failure while the existing Host restores its previous factory where cleanup permits.
Activation preserves configuration bytes and revision history.

Actual Main starts signed Hydra `3.0.0` through its ordinary production composition.
The actual CLI selects and activates `2.0.0`, then selects and activates `3.0.0` in the same Main process.
The installed MQTT SDK connects to an isolated loopback broker after each replacement.
Actual preload telemetry remains equal, cached health remains healthy, and normal shutdown removes the control socket and source handlers.
The first integration attempt lacked a runtime directory and correctly reported an unavailable control channel.
A private short runtime directory now enables the isolated channel without using operator state.

Independent review found the new runtime phase would use fixed Windows named pipes despite its private Unix runtime directory.
The runtime phase now declares a Windows skip until private named-pipe isolation exists.
The original Windows startup revision phases remain in the harness.
A fixture assertion also refuses direct Windows runtime activation.
The independent reviewer found no material defect in activation authority, capture integrity, or lifecycle handling.
Follow-up review confirmed the Windows isolation correction.
The final shared Main, Native, control, replacement, and bootstrap command passed all 74 checks without skips or failures.
It completed in 4.99 seconds.
The first full Shell gate exposed 21 missing-module failures in two VM fixtures after Main gained the new dependency.
Both fixtures now map the actual activation module.
The same run had one existing Electron package-verification timeout.
The affected wiring, routing, and package-control rerun passed all 31 checks in 7.56 seconds.
Personal Bot passed 587 tests with two skips and no failures in 59.39 seconds.
Its TypeScript check passed.
Remote Bridge passed all 65 checks with a short temporary root in 1.62 seconds.
The final complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,620 tests with two Windows-only skips and no failures.
It completed in 158.64 seconds after the VM fixture corrections and Windows isolation guard.
All ten changed JavaScript entry points passed syntax checks.
Local document references, new descriptive sentence bounds, and `git diff --check` passed.
Sentence bounds alone do not certify full STE dictionary or word-meaning conformance.

Renderer operator activation, development activation, new runtime identities, stylesheets, and multi-plugin activation remain open.
External brokers, Windows runtime activation, and CM5 acceptance remain unverified.


## Authenticated built-in Main restoration acceptance

The [restoration contract](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-built-in-main-restoration) owns default factories, graph recomposition, configuration independence, receipts, and remaining integration limits.
Four initial restoration regressions failed because the control and CLI did not recognize the command.
The repaired path restores default factories and consumers without reading publisher policy or changing saved selections.
Retained cleanup prevents default construction until retry succeeds.
Default startup failure restores the previous independent factory after candidate cleanup.
Constructor snapshots prevent later default declaration or factory mutation.
Shutdown cancels restoration queued behind signed capture.

Independent review found strict replacement rejected supported startup replacements with different dependencies, permissions, or compatible ports.
Explicit trusted recomposition now validates the complete candidate graph before resource release.
Host regressions cover optional consumers, invalid graphs, rollback, and dependency order.
Actual Main factory checks restore Camera after legacy port selection and Weather after an extension dependency.
Independent review also found the CLI still read malformed configuration before restoration.
An actual CLI regression reproduced that failure.
Restoration now bypasses that read and preserves malformed bytes.

Follow-up review found queued provider disable used a dependency closure captured before restoration.
A deterministic regression reproduced a consumer remaining running instead of becoming blocked.
The queued operation now recalculates its closure while retaining immediate cancellation.
The regression also checks recovery after provider enable.
Independent follow-up review confirmed these corrections and found no additional material defect.
The shared Host, Main, Native, control, actual bootstrap, and Renderer replacement command passed all 93 checks in 4.28 seconds.
The final restoration, concrete Main contract, and Host command passed all 54 checks in 0.97 seconds.
Personal Bot passed 587 tests with two skips and no failures in 42.23 seconds.
Its TypeScript check passed.
Remote Bridge passed all 65 checks with a short temporary root in 1.70 seconds.
The final complete Shell command, `corepack pnpm@11.22.0 test`, passed 1,633 tests with two Windows-only skips and no failures.
It completed in 163.53 seconds after the graph and queued-disable corrections.
All eleven changed JavaScript entry points passed syntax checks.
Local document references, new descriptive sentence bounds, and `git diff --check` passed.
Sentence bounds alone do not certify full STE dictionary or word-meaning conformance.

Actual Main and CLI now execute Hydra signed `3.0.0`, signed `2.0.0`, built-in `1.0.0`, and signed `3.0.0` in one process.
Installed MQTT SDK connections, actual preload telemetry, cached health, default construction, signed markers, and unchanged configuration identify and compare each phase.
The private loopback broker supplies controlled telemetry.
Windows runtime activation remains skipped until private named-pipe isolation exists.
Renderer operator activation, development activation, new runtime identities, multi-plugin activation, and supported-device acceptance remain open.

## Authenticated signed Renderer activation acceptance

The [runtime contract](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-signed-renderer-activation) owns Renderer capture, exact loading, receipt validation, and remaining limits.
Initial checks failed because the existing bridge did not accept activation and the Main capture module did not exist.
The repaired path uses current Native policy, verified bytes, authenticated discovery, coordinated placements, and the existing management channel.
Configuration bytes remain unchanged by activation.

Independent review reproduced two defects beyond the first passing checks.
A delayed definition from a rejected entry could supply old code under the next selection's manifest.
Definitions now require the currently executing selected script; a regression verifies that stale callbacks cannot poison the next load.
Repeated activation previously retained another random asset token for the same revision.
Capture reuse now follows fresh signature, policy, identity, and grant checks.
Forty repeated activations retain one capture, while publisher revocation still prevents reuse.
Both regression checks failed before repair.
The independent reviewer reran thirty-seven affected checks and found no further material activation defect.

The final shared command passed all eighty-seven checks in 7.24 seconds.
It covers preparation, browser collection, control receipts, native assets, runtime placements, CLI routing, and controller lifecycle.
The final complete Shell command passed 1646 checks with two skips and no failures.
It completed in 175.32 seconds from `runtime/shell/`.
Personal Bot passed 587 checks with two skips and no failures; its typecheck also passed.
Remote Bridge passed all sixty-five checks without skips.
Twelve changed JavaScript files passed syntax checks; affected document links and new sentence bounds also passed.

The [actual Main check](../tests/hydra-main-surface.test.js) passed its expanded three-check command after the complete Shell run.
It completed in 9.00 seconds.
One production document activates signed Hydra `3.0.0`, `2.0.0`, and `3.0.0` through the actual CLI.
Another starts with no signed surface assets, then installs and activates `2.0.0` and `3.0.0` without navigation.
Both phases retain the document, Widget container, actual MQTT source instance, and rendered attributes and text.
Actual preload, installed MQTT SDK, and an isolated loopback broker supply controlled telemetry.
The command also checks startup revision selection, rejected unsigned updates, rollback, removal, and shutdown release.
The existing full browser matrix retains its separate computed-style and geometry coverage.

Distinct revision retirement remains unimplemented; thirty-two captures and sixty-four mebibytes remain explicit process limits.
Renderer built-in restoration, Appearance activation, external stylesheets, and new runtime identities remain open.
Windows runtime phases remain skipped until private named-pipe isolation exists.
External brokers, physical input, CM5, and supported-device acceptance remain unverified.

## Authenticated built-in Renderer restoration acceptance

The [restoration contract](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-built-in-renderer-restoration) owns captured defaults, coordinated recovery, receipts, and stylesheet transitions.
Seven initial regression checks failed because the registry, controller, and control bridges lacked built-in restoration.
The repaired path captures packaged manifests, factories, and lifecycle functions before external surface entry execution.
Mutation after capture cannot change the restored implementation.
Queued disable prevents default construction when restoration reaches the management queue.
Failed old cleanup, failed default startup, and shutdown during release cannot produce successful recovery receipts.
Ordinary replacement refuses unsupported stylesheet binding changes before releasing the selected surface.

The first shared command exposed missing browser `structuredClone` globals in older VM fixtures.
Seven fixture files now supply the real API without changing their behavior assertions.
The first complete Shell command failed twenty-eight checks from those already-loaded fixtures.
The repaired fixture and restoration command passed all 180 checks in 0.57 seconds.
The final complete Shell command passed 1657 checks with two skips and no failures.
It completed in 160.29 seconds from `runtime/shell/`.
Personal Bot passed 587 checks with two skips and no failures; its typecheck passed.
Remote Bridge passed all sixty-five checks without skips.
Independent read-only review found no material defect in capture, lifecycle, concurrency, or recovery receipts.
Follow-up review confirmed the cleanup, shutdown, stylesheet, and fixture corrections.

The [actual Main command](../tests/hydra-main-surface.test.js) passed all three checks in 6.51 seconds.
Actual CLI activation selects signed Hydra `2.0.0`, restores built-in `1.0.0`, then activates signed `2.0.0` and `3.0.0`.
The recovery phase replaces configuration with malformed content and revokes publisher policy before invoking the actual restoration command.
Restoration preserves both files byte for byte.
The parent-owned fixture restores those files after the recovery assertion.
The document, Widget container, actual MQTT source instance, and rendered attributes and text remain unchanged across transitions.
A second runtime phase starts with no signed surface capture and exercises the same recovery sequence after installation.
Actual preload, installed MQTT SDK, and an isolated loopback broker provide controlled telemetry.
Shutdown releases the management listener, source handlers, and signed asset route.

The stylesheet recovery section below records subsequent recovery from external bindings.
Per-revision retirement, Appearance activation, new runtime identities, and supported-device acceptance remain open.
Windows runtime phases remain skipped until private named-pipe isolation exists.
These local results do not establish external broker, physical input, Windows runtime, or CM5 acceptance.

## Built-in Renderer stylesheet recovery acceptance

The [restoration contract](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-built-in-renderer-restoration) owns stylesheet loading, transition, rollback, and retained resource behavior.
The initial regression failed because built-in restoration refused an external startup stylesheet binding.
The [scoped checks](../tests/plugin-scoped-styles.test.js) now exercise inactive preparation, unavailable stylesheets, cleanup failure, rollback, shutdown, and queued contract validation.
Ordinary runtime replacement cannot request the private recovery exception.

The [isolated Electron check](../tests/renderer-css-recovery.test.js) measures applied widths in five recovery scenarios.
Its initial rollback assertion exposed missing rules after the old stylesheet link was disabled and enabled.
Media switching preserves the loaded stylesheet for immediate rollback.
Successful recovery activates the built-in stylesheet or removes the external stylesheet when the default has none.
Failed preparation, default mounting, and external cleanup preserve the external stylesheet and displayed value.
These checks retain the document and surface container through each operation.

The [actual Main check](../tests/hydra-main-surface.test.js) also installs a signed startup surface with captured CSS.
The actual CLI restores the built-in surface and removes the external stylesheet without navigation.
It preserves configuration bytes, the Widget container, rendered attributes and text, and the MQTT source instance.
Actual preload and an isolated loopback broker provide controlled telemetry.
Windows runtime phases remain skipped until private named-pipe isolation exists.

Independent review found no actionable issue and reran thirty-four checks, including all five Electron scenarios.
Integration review requested a direct running-version assertion after signed stylesheet recovery.
The actual Main fixture now verifies version `1.0.0` through the Renderer catalog as well as the CLI receipt.
The final focused command passed sixty-five checks without skips.
A concurrent verification run timed out after the Electron stylesheet fixture emitted its successful report.
The complete Shell run also failed Pi process shutdown and one Electron installation verification check during that run.
The subsequent sequential command passed all sixteen checks across those fixtures and the actual Main stylesheet recovery path.
No timeout or assertion limit changed.
The final complete Shell command passed 1669 checks with two skips and no failures in 222.10 seconds.
Arbitrary stylesheet replacement, per-revision asset retirement, and Appearance activation remain open.
These local checks do not establish external broker, physical input, Windows runtime, or CM5 acceptance.

## Unpublished Renderer capture retirement acceptance

The [activation contract](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-signed-renderer-activation) owns preparation capture retention and the remaining published revision boundary.
Four initial regressions failed because unpublished captures and their entry and byte allowances could not release.
The [preparation checks](../tests/native-renderer-activation.test.js) now repeat failed preparation forty times without retaining another capture.
They cover cancellation after verified capture, overlapping ownership, published capture retention, and closed loader callbacks.
Publication callback failure retains a potentially visible URL.

The [asset checks](../tests/native-renderer-plugins.test.js) verify the thirty-two-entry and sixty-four-mebibyte limits after retirement.
Live views observe publisher retirement and cannot request retirement themselves.
Independent snapshots retain their captured resources.
Independent review reproduced stale byte accounting when a snapshot followed a live view's publications or retirement.
A failing regression confirmed incorrect admission before snapshot accounting used current retained bytes.
The final focused command passed all twenty checks.
The reviewer independently confirmed corrected snapshot admission and found no further actionable issue within this scope.
The complete Shell command passed 1677 checks with two skips and no failures in 147.75 seconds.
Four changed JavaScript files passed syntax checks, and 375 local document links and anchors passed reference checks.

These checks use private signed stores and controlled preparation callbacks.
They do not establish resource retirement after browser publication, running factory release, or uncertain execution outcomes.
Published revision retirement and supported-device acceptance remain open.

## Authenticated Appearance factory restoration acceptance

The [recovery contract](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-built-in-appearance-restoration) owns configured default capture, declaration preservation, and receipt authority.
Six initial regressions failed because Appearance and Renderer management did not support factory recovery.
Host checks now cover private capture mutation, disabled identities, cleanup retry, default startup failure, and shutdown.
Declaration checks preserve configured palette values, installed-package documents, styles, and preference writes.
Browser checks confirm external release without another discovery or entry execution.

The [Electron fixture](../tests/appearance-restoration.test.js) executes signed startup loading and authenticated CLI recovery with actual preload.
Recovery succeeds after external configuration becomes malformed and publisher trust is revoked.
Both files retain their bytes during recovery.
The document and Clock node remain identical.
Computed font, geometry, radius, and primary color remain equal across Pixel, Instrument, and Border Beam.
The stored theme remains Pixel.
This fixture uses controlled Main composition and data responses, rather than production Main startup.

Independent review found that an additional management queue delayed disable cancellation during asynchronous factory construction.
A failing regression reproduced the un-aborted factory signal before repair.
The common Host now receives disable requests immediately and retains lifecycle serialization.
Follow-up checks cover disable during enable, default construction, and external cleanup.
The final focused command passed all seventy-three checks.
The reviewer independently reran all twenty-four Appearance Host checks and found no further actionable issue.
The first complete command reported one timeout in the existing concurrent Electron verifier check.
Its isolated file passed all seventeen checks without changes to timeouts or assertions.
The subsequent complete Shell command passed 1688 checks with two skips and no failures in 201.54 seconds.
Nine JavaScript files passed syntax checks, and 406 local document links and anchors passed reference checks.
The complete Shell E2E command passed driver, motion, geometry, style, sequential-state, density, and theme checks.
Its six density runs and seven theme fixtures returned zero exit codes.

Windows runtime recovery remains skipped until private named-pipe isolation exists.
Appearance activation, arbitrary independent themes, live installed-package runtime interaction, and supported-device acceptance remain open.
These checks do not establish live providers, physical input, or production Main integration.

## Authenticated Appearance factory activation acceptance

The [activation contract](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-signed-appearance-activation) owns scoped loading, preserved declarations, candidate cancellation, and receipt authority.
Three initial regressions failed because Appearance lacked runtime replacement and management routing.
A further failing regression confirmed entry execution after disable during pending discovery.
The repaired path cancels pending discovery before script execution.

The [Appearance browser checks](../tests/native-appearance-plugins.test.js) verify current publisher policy before capture reuse and reject data-only palette activation.
They cover exact entry selection, delayed definitions, disabled identities, preserved preferences, and candidate cancellation during construction and startup.
The [Host checks](../tests/appearance-plugins.test.js) verify independent factory execution, declaration equality, startup rollback, and owned cleanup.
The common Host rejects cancelled queued replacement before releasing its current implementation.

The [Electron checks](../tests/appearance-restoration.test.js) use actual preload, authenticated management, the CLI, and independently signed factories.
One phase starts with signed Appearance assets; another starts with none.
Both activate signed version `4.0.0` twice and restore built-in version `1.0.0` without document navigation.
They reject malformed configuration, revoked publisher policy, and changed stored signed bytes before successful activation.
The document, Clock node, saved theme, and three themes' measured font, geometry, radius, and primary color remain unchanged.
Activation preserves saved plugin configuration bytes.
These fixtures use controlled Main composition and data responses.

Independent review found that cancellation stopped entry loading but did not reach candidate factory startup.
Failing regressions reproduced retained running candidates after cancellation during construction and startup.
The repaired candidate uses the activation signal only during its first construction and startup.
Follow-up review found that retaining the expired signal could break later enable and rollback construction.
Another failing regression reproduced this failure before the request signal became limited to the initial construction.
Later enable, rollback, and Host restart use fresh Host lifecycle signals.
A final release-cancellation regression also checks abort and disable while the previous factory stops.
The Host retains the previous definition instead of installing an unstarted cancelled candidate.
Independent re-review confirmed this behavior and found no remaining actionable issue within the changed scope.
An expanded Electron comparison initially crossed a clock-reading change and compared different input text.
The fixture now supplies fixed time and compares text as well as geometry without wider tolerances.
The affected command passed all 190 checks before discovery capacity coverage.
Two further failing regressions exposed missing Appearance discovery capacity checks before capture and before publication.
The repaired activator preserves the thirty-two-entry discovery limit and releases unpublished captures when capacity fills during preparation.
Independent review found no actionable issue in these capacity checks.
The final affected command passed all 192 checks.
The complete Shell command passed 1706 checks with two skips and no failures in 159.63 seconds.
The complete Shell E2E command passed driver, motion, geometry, style, sequential-state, density, and theme checks.
All six density runs and seven theme fixtures returned zero exit codes.
Fifteen changed JavaScript files passed syntax checks, and 441 local document links and anchors passed reference checks.

Production Main acceptance, live installed-package interaction, Windows runtime isolation, and supported-device acceptance remain open.
Published revision retirement and arbitrary independent themes remain open.
These local checks do not establish live providers, physical input, or deployment.

## Production Main Appearance and installed App acceptance

The [production Main checks](../tests/appearance-main-bootstrap.test.js) launch the actual Main composition with private profiles, configuration, state, and runtime channels.
Two scenarios start with a signed Appearance selection or without external Appearance assets.
The actual preload installs an interactive HTML App through the production verifier and package runtime.
No Main capability, IPC response, package verifier, or protocol handler is replaced.
The fixture hides its window, selects supported software rendering, and controls time before loading the production Shell document.

Authenticated CLI activation selects independent signed factories for versions `2.0.0` and `3.0.0`.
Lifecycle traces verify external cleanup before the next factory construction.
Receipts match the running Appearance catalog and stored revision.
The same Shell document, Clock node, and opaque installed App frame remain available.
Programmatic button interaction produces retained App memory state.
Shell and App measurements remain equal to their baseline across Pixel, Instrument, and Border Beam.
The App retains its sandbox, loaded font, and lack of parent DOM or preload access.

Built-in recovery succeeds after configuration becomes malformed and publisher trust is revoked.
Recovery preserves both files and the saved theme preference.
Shutdown releases actual IPC handlers, protocols, Hosts, and both management sockets.
The parent checks the same socket paths that existed before the operations.

The initial missing-fixture checks failed before implementation.
The first implemented run exposed an uninitialized debugger target before document loading.
The fixture now initializes a hidden blank document before installing controlled time and loading the Shell.
Independent review found an incorrect Renderer socket path that could falsely certify cleanup.
The corrected check resolves both endpoints through production Host configuration.
Re-review found no remaining actionable issue within this scope.
One concurrent affected run failed actual App installation verification.
The same four files then passed all thirty-seven checks sequentially without timeout or assertion changes.
The first complete Shell command passed 1707 checks with one installation verification failure and two skips.
The fixture subsequently selected the existing software rendering option without changing verifier policy or its deadline.
Both new scenarios passed in the next standard complete command.
That command passed 1706 checks with two failures and two skips.
The existing Hydra revision comparison measured different intermediate meter transforms.
The existing CLI installation check reported a verification failure.
These results do not establish the cause of concurrent failures or a passing standard complete gate.
The subsequent complete sequential Shell command passed 1708 checks with two skips and no failures in 567.80 seconds.
Both previously failing checks passed in that command without assertion or deadline changes.
The command used `node --test --test-concurrency=1 tests/*.test.js`.
The standard command at that revision still had unresolved concurrent failures.
Both new JavaScript files passed syntax and whitespace checks.
All 394 local links and heading anchors in the three affected documents passed reference checks.

These checks establish controlled macOS production composition and programmatic installed App interaction.
They do not establish GPU rendering, physical input, assistive technology, live providers, Windows isolation, or CM5 acceptance.
Arbitrary independent themes and published revision retirement remain open.

## Plugin verification scheduling and static measurement

The Hydra static comparison previously inserted an inline stylesheet into the actual Shell document.
The production content policy blocks inline stylesheets.
A new computed-style assertion failed before repair because meter motion remained active during sampling.
The [Hydra fixture](../tests/hydra-surface-electron.cjs) now uses a constructed stylesheet scoped to its acceptance container.
It checks zero transition duration and no meter animation before each measurement.
Each completed comparison removes its stylesheet.
Failure cleanup destroys the fixture window.
Product styles, content policy, and animation behavior remain unchanged.

The recorded CLI installation failure reported `verification-timeout` with the production verifier deadline.
The standard [test command](../package.json) now executes test files sequentially to limit competing Electron processes.
This changes scheduling between independent test files and increases complete verification time.
Tests still execute their explicit concurrent requests, lifecycle transitions, and parallel verifier scenarios.
No verifier deadline, assertion, rendering tolerance, or feature concurrency contract changed.
Independent source review found no actionable issue in the scheduling and stylesheet changes.
The affected command passed all thirty-two checks, including signed process restarts and real CLI installation.
The standard `pnpm test` command passed 1708 checks with two skips and no failures in 538.27 seconds.
Its explicit concurrent verifier scenario also passed.
The isolated [Hydra style check](../tests/hydra-style.cjs) passed thirty composition cases and ten unconfigured cases.
That check retains normal transition and reduced-motion assertions without the static comparison stylesheet.
The fixture passed syntax and whitespace checks.
Local document links, heading anchors, and added sentence lengths passed content checks.

## Uncertain Renderer implementation operation acceptance

The [management owner](../src/renderer-management.js) retains an uncertain implementation operation after the public request ends.
Only valid completion from its original main frame releases a dispatched operation's slot.
Invalid, foreign, duplicate, and navigated-frame reports cannot clear that slot.
A send that exposes a request before throwing retains the same uncertainty.
Timed-out preparation retains its slot until loading settles without dispatch.
If completion never arrives, further authenticated implementation changes require a Shell restart.
Inventory and lifecycle requests retain their existing availability.
The original timed-out request keeps its uncertain outcome; late completion does not replay it.

The regression command failed before repair because timeout permitted another implementation change.
The [management checks](../tests/renderer-management.test.js) cover timeout, late completion, invalid reports, preparation, send failure, navigation, and shutdown.
The [capture check](../tests/native-renderer-activation.test.js) preserves earlier published resources after another revision is selected for discovery.

An initial retirement implementation passed 1716 checks with two skips in the standard complete command.
Additional independent review then found an uncovered supported ownership path.
Callers can retain `odkPlugins.get(id)` and later pass that definition to `odkRendererRuntime.replace()`.
A management receipt cannot establish release of those references or queued programmatic replacements.
Retirement could remove signed lazy assets before a retained definition uses them again.
The retirement integration and its completion claims were withdrawn.
The passing command does not certify that withdrawn implementation's behavior compatibility.
Published captures remain retained under the existing contract.

The final affected command passed all thirty-one checks, including actual Main Hydra and both production Appearance scenarios.
Independent re-review confirmed removal of the unsafe retirement path and found no actionable issue in the retained management repair.
The final standard complete command passed 1712 checks with one failure and two skips in 582.43 seconds.
All five added regression and retention scenarios passed in that command.
The existing Hydra runtime-development comparison reported differences in computed rule widths and font geometry.
That fixture exercises programmatic replacement without constructing the modified management module.
The rendering failure's cause remained unresolved; that candidate's standard complete gate did not pass.
The failed runtime-development scenario then passed an isolated rerun without source, assertion, or tolerance changes.
That rerun does not clear the recorded complete-gate failure or establish its cause.
Source and test hashes remained unchanged during verification.
Syntax, scoped whitespace, and all 401 local links and heading anchors passed checks.

Published retirement requires explicit ownership across loaded definitions, queued operations, selected factories, discovery, caches, and independent snapshots.
The authenticated management slot alone does not provide that ownership model.
Supported retained-definition reuse must preserve its resources or follow an explicitly authorized contract change.
Published revision retirement, supported-device acceptance, and recovery from permanently lost completion without restart remain open.

## Hydra replacement comparison rendering inputs

The previous complete command reported computed rule-width and font-geometry differences in the Hydra runtime-development comparison.
That run did not record its device scale or page zoom.
Its passing isolated rerun did not establish the historical failure's cause.

An isolated Electron experiment confirmed that rendering scale can change computed rule widths and font geometry.
The new conflicting-scale regression failed before repair because the document reported `devicePixelRatio=2`.
Appending a replacement switch inside Main did not override the incoming startup value in the installed runtime.
Both [comparison](../tests/hydra-surface-electron.test.js) and [process-restart](../tests/hydra-surface-restart.test.js) launchers now specify a device scale of one before Electron startup.
The [Chromium switch](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/display/display_switches.cc) controls browser and content device scale.
The [fixture](../tests/hydra-surface-electron.cjs) resets page zoom after document loading.
Before each measurement, it requires a device pixel ratio and visual viewport scale of one.
Changed inputs fail before geometry sampling.
Comparison failures also identify the phase, theme, cell, and reading state.

The conflicting-scale scenario passed after the launchers normalized the incoming scale request.
It still compares default, independent, and restored surfaces in one document.
Geometry, computed styles, fonts, containment, readable floors, and placement assertions retain their existing criteria.
Product styles and product launch settings remain unchanged.
This scenario proves controlled comparison inputs, not rendering acceptance at a device scale of two.
The final standard complete command passed 1714 checks with two skips and no failures in 585.91 seconds.
All four candidate source and test hashes still match that completed run.
The historical failure's exact cause remains unproven.
Published asset retirement and the feature matrix's remaining replacement and supported-host acceptance gates remain open.

## Camera independent surface and subscription ownership

This historical section records acceptance for the retired Camera Widget. The Camera source and UVC hardware checks remain active.
The new regression reproduced a default subscription retained after surface release.
Built-in recovery then attempted another subscription while the old listener still owned the service.
The default and independent surfaces now register cleanup with the existing registry and fence late callbacks before cancellation.
Failed cancellation remains owned for explicit retry.
Source capture, image placement, visible wording, and refresh cadence remain unchanged.

The affected command passed all thirteen lifecycle and existing tile checks.
The former Electron check passed development loading and seventy-two replacement and recovery comparisons.
It retains one document, the desktop placement, and the measured container across default, independent, and built-in recovery phases.
Generated images decode into distinct red and blue regions with the same intrinsic aspect ratio.
Three themes, three sizes, and four sequential readings retain complete computed styles, attributes, text, geometry, and containment.
Actual preload uses controlled IPC; no physical capture or external provider executes.
Parent-owned commands wait for child closure before private state deletion.

Independent review found no actionable lifecycle, compatibility, loading, or isolation issue and passed all thirteen affected checks.
The final standard complete command passed 1725 checks with two skips and no failures in 584.43 seconds.
All seven candidate source and test hashes remained unchanged through that command.
The style build passed without changing generated styles.
Isolated Widget and App style checks passed.
The existing default density check passed five resolution profiles without violations.
That density result does not establish independent surface density.
Syntax, scoped whitespace, and all 418 local links and heading anchors passed checks.

The design detector reports the intentionally source-free hidden image as a broken image.
A file-scoped rule exception records the hidden unavailable-state contract for the default and independent entries.
Shared checks verify hidden state and source removal.
Signed surface revisions, joint production Main composition, physical input, Windows, and CM5 remain open.

## Camera signed surface and joint production Main revisions

The signed browser scenario initially failed because the fixture only selected development entries.
It now captures the signed surface through the production loader and explicit live asset protocol.
After capture, stored entry mutation fails fresh verification while the browser executes the original signed bytes.
Its revision marker and seventy-two default, independent, and recovery comparisons identify execution and preserved behavior.
Shutdown removes discovery IPC and the protocol handler; publisher closure returns status `410` for captured entry requests.

The joint Main scenario initially failed because its report had no mounted Camera surface evidence.
The [production Main fixture](../tests/camera-main-bootstrap.cjs) now has an optional joint source and surface branch.
Existing source-only cases retain their original assertions and synthetic frame bytes.
The joint branch executes the independent signed source through the production capture primitive with controlled files and commands.
Generated JPEG frames decode at 1280 by 720 with distinct red and blue regions.
Actual preload and the production Camera service deliver those frames to the selected desktop surface.

The former revision checks ran eight separate Main processes across live and unavailable states.
Each state selects surface versions `2.0.0`, `3.0.0`, `2.0.0`, and default `1.0.0`.
The independent source stays at version `2.0.0` without default source construction.
Actual child PIDs and entry markers bind each report to its process and implementation.
Surface text, attributes, capture time, visibility, decoded regions, and image placement remain equal across launches.
Unsigned updates preserve configuration bytes.
Transitions retain the source selection, unrelated Clock preference, and all stored revisions.
Each process performs one controlled capture and releases source, discovery, and signed route resources before exit.

The affected command passed all nineteen checks, including both original source-only bootstrap scenarios.
The final standard complete command passed 1728 checks with two skips and no failures in 623.46 seconds.
All eight candidate code and test hashes remained unchanged through verification.
Fresh independent read-only review found no actionable trust, execution, isolation, or lifecycle issue.
The reviewer did not execute tests.
Syntax, scoped whitespace, and all 423 local links and heading anchors passed checks.
No product implementation, capture limits, styles, or runtime API changed in this increment.
Authenticated operator activation, published resource retirement, independent density, external capture, physical input, Windows, and CM5 remain open.

## Camera authenticated surface activation and recovery

The former joint Main checks exercised authenticated Renderer activation through the actual operator CLI.
Each live and unavailable state starts one signed surface process and one process with an initially empty native asset route.
Both retain the document, desktop container, source instance, decoded frame, capture time, and one controlled capture across four transitions.
Recovery preserves malformed configuration and revoked publisher-policy bytes while selecting the captured built-in surface.
Later signed activation resumes after the fixture restores its private files.
Receipts identify the Renderer runtime and selected signed revision.
Final shutdown releases subscriptions and the authenticated endpoint.

Independent review found that the initial subscription was outside the first tracking window.
Tracking now installs before service publication and asserts the initial mount before runtime transitions.
Isolated tracker checks passed while the first document injection attempt still timed out.
The fixture now initializes the browser target before installing its document-start script, following existing Electron fixtures.
Required-phase failure stops dependent operations and retains available child diagnostics before cleanup.
The corrected focused command passed all twelve checks.
All fifty-two Camera checks then passed with no skips or failures in 50.74 seconds.
Fresh independent review confirmed the original finding was resolved and reported no actionable repair findings.
The reviewer did not execute tests.

The final standard complete command reported 1736 passes, one failure, and two skips in 962.00 seconds.
All eighteen candidate file hashes remained unchanged.
The failure occurred in `hydra-main-bootstrap.test.js` after its child reported healthy consumers and released handlers.
That child did not exit before the outer 55-second limit and received `SIGKILL`.
The isolated repeat passed both Hydra bootstrap checks in 4.23 seconds without code changes.
This repeat does not establish the original exit failure's cause or clear the failed standard gate.
The exit failure remains unresolved.
Syntax, scoped whitespace, and all 394 local document references and heading anchors passed checks.
This increment changes test fixtures and acceptance documentation; it does not change product code or runtime contracts.
Published resource retirement, independent density, external capture, physical input, Windows runtime activation, and CM5 acceptance remain open.

## Camera independent desktop density and exit diagnostics

The density scenario initially failed because the Camera browser report contained no desktop density evidence.
Both development and signed entry modes now measure the actual desktop container through the existing Widget collector.
Default, independent, and restored surfaces cover three themes, five standard viewports, and live and unavailable readings.
Each mode performs ninety measurements and sixty default-baseline comparisons.
The shared density limits remain unchanged; Camera has no separate profile.
Checks retain viewport dimensions, scale, zoom, loaded fonts, theme, document identity, container identity, and scoped motion controls.
The collector measures text and SVG framing marks, not raster frame pixels or screenshot equivalence.

An initial signed run completed its assertions and report but did not close before the process limit.
The fixture now explicitly releases its owned debugger connection before window destruction.
A subsequent serialized run passed both entry modes and process closure.
This result does not identify the earlier exit failure's cause.

The Hydra bootstrap fixture now records actual `before-quit`, `will-quit`, verified release, and `quit` phases in its private profile.
Its new phase assertion first failed because the journal did not exist.
Successful launches now check the journal after actual child completion.
Failed launches append available phase evidence before private cleanup.
The journal cannot replace process closure or relax the existing timeout.

All fifty-eight affected Camera and Hydra checks passed in 52.21 seconds.
All seven fixture-isolation and geometry-entrypoint checks passed.
The geometry command now includes the isolated Camera replacement matrix.
Fresh independent read-only review found no actionable density, isolation, cleanup, or journal issue.
The reviewer did not execute tests.
The style build passed without changing generated CSS.
The standard complete command reported 1737 passes, two failures, and two skips in 722.46 seconds.
All twenty-three candidate file hashes remained unchanged.
Both failures occurred in the Appearance Main fixture when installed App verification returned `verification-failed`.
Both isolated repeats passed without code changes in 5.63 seconds.
Their underlying verifier failure remains unresolved; these repeats do not clear the failed complete gate.
The Camera density matrix and Hydra quit-phase assertions passed in the complete command.
The earlier Hydra exit failure remains unexplained despite this later passing path.
Syntax, scoped whitespace, and all 394 local document references and heading anchors passed checks.
The complete geometry aggregate was not run in this test-only increment.
Product geometry, source behavior, runtime contracts, density thresholds, and deployment state remain unchanged.
Published resource retirement, physical capture, physical input, Windows, and CM5 remain open.

## Native Camera surface fixture acceptance

This historical result applies to the retired Camera Widget surface. The Camera source and UVC hardware checks remain active.

Both initial host runs failed their two Camera surface cases with `CAMERA_SURFACE_TIMEOUT`.
Private diagnostic copies retained the original 45-second fixture limit and synthetic frames.
CM5 stopped during the first comparison with graphics errors.
Windows completed comparison groups slowly until the limit.
Offscreen drawing and Linux-only software rendering let CM5 complete the unchanged matrix.
That Windows experiment then exposed different initial and later viewport dimensions.
The fixture now uses its existing viewport helper before the first comparison.
It retains the existing scale, font, density, decoded-frame, replacement, recovery, and release assertions.
The five new isolation regressions failed before these three fixture repairs.
The final affected local command passed 95 checks without failures or skips in 23299 milliseconds.
The final native Windows and CM5 commands each passed eight checks without failures or skips.
Windows completed in 24.670 seconds; CM5 completed in 63.007 seconds.
Both commands captured 262 inputs that remained unchanged and match the current worktree.
The commands cover development and signed surface selection plus six Camera fixture checks.
Windows ran in the logged-in interactive session.
The temporary Windows tasks and diagnostic copies were removed after terminal receipts and process checks.
The fixtures deny network requests and media permissions; they never construct a physical Camera source.
These results establish controlled surface acceptance, not physical capture, display, or input acceptance.
Product sources, runtime contracts, measurement limits, and time budgets did not change.

## Camera Main host acceptance and private Windows channels

The initial CM5 joint Main command passed six checks without skips across 266 unchanged inputs.
It exercised signed source and surface startup, revisions, authenticated activation, recovery, and resource release with synthetic frames.
The Windows receipt and temporary task cleanup could not be retrieved after the host went offline.
The outstanding task is `OdkCameraMainAcceptd48b5acd`; its private directory ends with `clock-accept-d48b5acd`.
No new Windows task was started while the host was unavailable.

The previous Windows activation cases were skipped because their channels could collide with an existing Shell.
A test-only adapter now maps every known endpoint to a unique private pipe prefix.
It retains native Windows host resolution, private state paths, and the selected authentication token file.
Both Main fixture parents supply the prefix; the child and runtime CLI load the adapter before production modules.
Invalid or absent prefixes refuse Windows fixture startup.
The adapter does not intercept authentication, discovery responses, command dispatch, or lifecycle operations.
Windows cleanup checks the existing token file before requiring the Renderer control pipe connection to fail.
Unix cleanup retains its existing socket removal assertion.

Seven isolation regressions failed before implementation; two unchanged Unix checks already passed.
An additional regression caught the second Main parent without a prefix before its correction.
The final local affected command passed 36 checks and skipped one Windows-only channel case in 20348 milliseconds.
Its 671 captured inputs remained unchanged.
The final CM5 command passed seventeen Camera checks without skips in 50945 milliseconds.
All 263 captured inputs remained unchanged and match the current worktree.
A fresh independent source review found no actionable isolation or cleanup issue.
The reviewer did not execute native Windows checks.
Native Windows activation, prior task cleanup, physical capture, and physical input remain unverified.
Product sources and endpoint contracts did not change.

## Appearance verification outcome observation

The [Main fixture](../tests/appearance-main-bootstrap.test.js) now records the actual App verifier verdict before checking installation.
Its observer preserves production factory options, arguments, results, and deadlines.
Diagnostics retain only the verdict and bounded error; they exclude package contents and subprocess output.
Signed and initially empty startup paths still exercise successful installation and retained Appearance context.
A controlled rejected package exercises the same production verification path.
That case checks the existing public failure response, empty catalog, absent App surface, retained Appearance, and normal resource release.
All cases still require actual child closure before private profile removal.

The missing observation and controlled rejection each produced a failing regression before the fixture change.
The corrected Main command passed all three checks.
The affected Appearance and installed App command passed all eighty-six checks with no failures or skips.
Fresh independent source review found no actionable issue; the reviewer did not execute tests.
These checks do not directly observe the verifier subprocess or its temporary directory.
The controlled rejection does not identify the earlier complete-command failures.
The standard complete command passed 1740 checks with two skips and no failures in 648.07 seconds.
All fourteen candidate file hashes remained unchanged through that command.
The earlier Appearance failures did not recur; their historical cause remains unresolved.
Syntax, scoped whitespace, and all 284 local coverage-document references and heading anchors passed checks.
Windows, CM5, physical input, live providers, and verifier subprocess cleanup remain outside this increment's evidence.
Production verification behavior, policy, and deadlines remain unchanged.

## Clock independent surface replacement

The [Clock contract](CLOCK_SURFACE_PLUGIN_CONTRACT.md) now defines local time formatting and shared Tick ownership.
The independent example owns its formatting algorithm without calling the default Clock factory.
It shares static markup, Shell styles, fonts, and the public Tick service.
Missing independent code initially failed the new lifecycle scenarios.
One initial test incorrectly expected a rejected disable promise; it now checks the existing `cleanup-failed` catalog state.
Both implementations preserve padded local time, midnight, backward changes, unchanged-minute writes, disable, enable, and failed cleanup retry.

The [browser fixture](../tests/clock-surface-electron.test.js) loads trusted development links and signed packages through actual preload and the production loader.
It uses a controlled Date before document loading, loaded fonts, fixed scale, and scoped static comparison styles.
Default, independent, and restored surfaces cover three themes and three square cell sizes.
Each loading mode performs eighteen baseline comparisons and six actual shared Tick updates.
Checks retain both active containers, document identity, time attributes, computed styles, geometry, and subscription ownership.
Final shutdown checks discovery release, signed asset closure, and actual child completion.
The fixture uses the public Renderer controller; it does not exercise authenticated production Main activation.

The initial missing browser entry prevented acceptance and required termination of the task-owned Electron launcher.
A pre-launch file check now rejects that missing entry without starting Electron.
The first signed package failed installation because its file list was not sorted as required.
The corrected fixture retains the production signature checks.
Fresh independent review found that retained desktop markup alone could conceal an inactive or old definition.
Every phase now checks the desktop's selected active definition and actual shared Tick updates in both containers.
Source re-review confirmed that finding was resolved and found no additional actionable issue.
The reviewer did not execute tests.
All forty-eight affected Clock, isolation, loader, and runtime replacement checks passed in 15.26 seconds.
The style build passed.
The geometry command now includes the isolated Clock comparison matrix.
The complete geometry aggregate was not run in this test-only increment.
The standard complete command passed 1747 checks with two skips and no failures in 620.30 seconds.
All twelve candidate hashes remained unchanged through verification.
A later scenario wording correction changes no executable behavior.
Syntax, scoped whitespace, and all 417 local references and heading anchors in the four affected documents passed checks.
Density, authenticated Main activation, live time progression, timezone changes, physical input, Windows, and CM5 remain open.

Controlled Clock replacement checks subsequently passed on Windows x64 and CM5 Linux arm64 on 2026-10-10.
Each host passed development loading and signed loading with zero failures or skips.
Windows completed in 13.39 seconds in the logged-in interactive Session 1.
CM5 completed in 20.20 seconds as `orangepi`.
All 181 captured inputs remained unchanged on each host and matched the local inputs afterward.
Each mode retained eighteen comparisons, six shared Tick updates, active containers, restoration, and resource-release assertions.

The first Windows attempt found native content bounds smaller than the requested comparison viewport.
The fixture now sets content size, renderer metrics, and unit zoom after loading.
Later hidden-window attempts exceeded their existing deadline during restored-surface comparisons on both hosts.
A Linux headless attempt also crashed before comparisons; it established no acceptance.
The final fixture uses offscreen rendering; Linux also uses software rendering without the headless Ozone flag.
Both regression checks failed before their corresponding repairs.
All 22 affected local checks then passed with zero skips in 13.93 seconds.
A fresh independent source review found no actionable findings.
The comparison count, measurement assertions, and deadlines were not relaxed.
Four completed Windows acceptance tasks were removed after their process receipts became terminal and no task-owned processes remained.
Existing product services and active releases were not changed.

These results establish controlled offscreen DOM, computed-style, and geometry behavior on both hosts.
They do not establish screen pixels, native display scaling, physical input, real time progression, or timezone transitions.
Independent density, authenticated Main activation, and those remaining device behaviors require their applicable checks.

## Almanac, Year, and State Bar Clock independent replacements

The [calendar and State Bar contract](CALENDAR_TIME_SURFACE_PLUGIN_CONTRACT.md) now defines three independent replacement surfaces.
Each example owns its date or time projection without calling the default factory.
Static markup, Shell styles, fonts, and the public shared Tick remain shared dependencies.
Missing entries initially failed the new shared lifecycle scenarios.
The lifecycle fixture captures built-in defaults before installing delegation guards, matching the production loading order.
Both implementations preserve date transitions, write counts, failed cleanup ownership, disable, enable, and built-in recovery.
Almanac includes different times on the same date, leap day, month boundaries, and year boundaries.
Year includes precise meter values and the 100-percent numeral class.
State Bar Clock retains its existing update on every Tick.

Year projection also runs in isolated Node processes with New York and Shanghai timezones.
The checks prove different spring and autumn elapsed intervals before comparing both implementations with local-year elapsed time.
These timezone checks do not establish browser timezone acceptance.

The [browser fixture](../tests/calendar-surface-electron.test.js) exercises actual preload, development links, signed loading, and the public Renderer controller.
Each loading mode replaces and restores all three surfaces in one unchanged document.
Three themes and three square cell sizes produce fifty-four baseline comparisons per mode.
Twelve controlled date changes per mode update both actual and comparison consumers through the actual shared Tick.
Checks retain active selected definitions, real containers, text, classes, styles, geometry, and subscription ownership.
Final shutdown releases discovery and signed assets before actual child completion.
The initial browser failure exposed CSS serialization from `100.00%` to `100%` after all consumers had already updated.
The fixture now normalizes expected widths through browser CSS serialization before strict comparison.
It does not change Year arithmetic or the production renderer.

The first sixty affected checks passed before the explicit timezone additions.
Fresh independent source review found no actionable issue in either the initial increment or the later timezone checks.
The reviewer did not execute tests.
The final affected command passed all sixty-two checks with no failures or skips in 41.30 seconds.
The style build passed without changing generated CSS.
The standard complete command reported 1760 passes, one failure, and two skips in 748.04 seconds.
All seventeen candidate hashes remained unchanged through verification.
The failure occurred during `update notes` in the actual Electron verifier CLI scenario.
Its recorded verifier verdict was `verification-timeout`; the underlying delay remains unexplained.
All new calendar and State Bar checks passed in that complete command.
The isolated CLI repeat passed its single selected scenario without code changes in 6.02 seconds.
It rejected broken HTML with the expected actual error after successful install, update, and rollback.
This repeat does not explain the earlier timeout or clear the failed complete gate.
Syntax, scoped whitespace, and all 428 local references and heading anchors in the four affected documents passed checks.
The geometry command includes this isolated replacement matrix; the complete geometry aggregate was not run in this test-only increment.

Production Main activation checks completed on 2026-10-10 through the existing [Clock startup fixture](../tests/clock-main-bootstrap.test.js).
One additional case installs the three existing independent entries under one scoped publisher policy.
Actual Main runs every plugin with private state and controlled external inputs.
The CLI activates each signed surface and restores its built-in implementation without changing saved selections.
Executed entry markers and default mount guards identify independent execution.
Twelve controlled date transitions preserve actual container markup and readings across default, signed, and restored phases.
They include leap day, year end, the next year, and a backward date change.
Shared Tick counts, foreground App identity, Main port identities, and document identity remain unchanged.
Normal shutdown releases subscriptions, handlers, signed protocol routes, and private listeners.
Before package installation, the same scenario failed at Almanac activation; the completed focused check passed in 21438 milliseconds.
The affected startup, browser, lifecycle, Native management, and Renderer replacement command passed 43 tests without failures or skips in 84909 milliseconds.
No production source changed, and no new test framework or management interface was added.
Density, screenshot equivalence, live clock progression, physical input, and supported-device acceptance remain unverified.

```sh
node --test --test-concurrency=1 tests/clock-main-bootstrap.test.js tests/calendar-surface-electron.test.js tests/calendar-surface-lifecycle.test.js tests/clock-surface-lifecycle.test.js tests/renderer-runtime-replacement.test.js
```
### Native calendar surface acceptance

Controlled replacement checks passed on Windows x64 and CM5 Linux arm64 on 2026-10-10.
Both hosts passed development loading and signed loading with zero failures or skips.
Windows completed in 25.89 seconds in the logged-in interactive Session 1.
CM5 completed in 35.06 seconds as `orangepi`.
All 186 captured source, fixture, helper, and package inputs remained unchanged on each host and matched the worktree afterward.
Each loading mode retained fifty-four surface comparisons and twelve controlled shared Tick changes.
The checks preserved actual and sample consumers, active selected definitions, document identity, subscriptions, restoration, discovery release, and signed asset release.

Two new regression cases failed before the fixture repair.
They reused the Clock isolation checks to reproduce missing renderer metrics and offscreen rendering in the calendar fixture.
The fixture now sets its content size, viewport, and unit scale after loading and renders offscreen.
Linux uses software rendering without the headless Ozone flag.
Comparison counts, geometry assertions, Tick deadlines, and process deadlines remain unchanged.
The affected local command passed 37 checks with zero skips in 40.90 seconds.
It included both loading modes for Calendar and Clock, calendar lifecycle checks, timezone projection checks, and isolation regressions.
A fresh independent source review found no actionable findings; the reviewer did not run checks.
The completed Windows acceptance task was removed after terminal confirmation and a task-owned process check.
No task-owned acceptance processes remained on either host.
Production source, active releases, and product services did not change.

These results establish controlled offscreen DOM, computed-style, and geometry behavior on both hosts.
Independent density, compact State Bar interaction, native display pixels, live clock progression, physical input, and browser timezone changes remain unverified.


## CLI verifier process observation

The [CLI acceptance scenario](../tests/plugin-cli-management.test.js) now retains bounded process observations for its four sequential verifications.
The [test observer](../tests/helpers/verifier-observation.js) wraps the existing spawn dependency without changing arguments, options, or the returned child.
It records spawn, observed file or stdout verdicts, actual verifier outcome, exit, and close phases with elapsed times.
Snapshots exclude package contents, filenames, environment values, subprocess output, and unrestricted error messages.
File and stdout observations are best effort; their absence cannot prove that no result was written.
They do not identify Electron readiness or document-loading phases.

The [observer checks](../tests/verifier-observation.test.js) initially failed because the helper was absent.
Controlled checks cover original spawn errors, watcher failure, private-field exclusion, and reported success without actual child closure.
A success file and stdout report still produce the production timeout when the controlled child never exits.
The fixture retains its original production deadline and verdict.
Observer cleanup waits for actual child closure with a separate bounded test failure; it does not terminate or accept the child.
This does not certify verifier profile cleanup.

The actual CLI path preserves installation, update, rollback, controlled rejection, and the previous installed revision.
Its assertions require actual result observations and normal process closure for each verification.
Failures retain the initiating command error and append safe phase evidence.
The final affected command passed all forty-two checks with no failures or skips in 16.01 seconds.
Fresh independent source review found no actionable issue and did not execute tests.
The standard complete command passed with 1765 passes, no failures, and two skips in 670.96 seconds.
All eight verifier observation and production boundary candidate files remained unchanged.
This command started before the later static desk tool additions; it does not certify those additions.
The earlier CLI update timeout remains unexplained.
No production verifier, runner, store, or control behavior changed in this increment.
Other independent plugin implementations and supported-host acceptance remain unfinished.

## Static desk tool independent replacements

This historical section records replacement acceptance for the retired Chatbot and Settings widgets. The [Pomodoro contract](POMODORO_SURFACE_PLUGIN_CONTRACT.md) remains active.
The [current helper](../tests/helpers/desk-tool-surfaces.js) constructs the Pomodoro surface without calling its default factory.
The Chatbot and Settings design remains in the [Widget design reference](../../../.agents/skills/odk-widget/references/design.md).
Static artwork, Shell styles, fonts, and placement remain shared product dependencies.
The fixtures preserve pending integration, not-started state, and display-only behavior without adding services or controls.
Pre-order countdown and canvas replacement remain open separately.

The [browser fixture](../tests/desk-tool-surface-electron.test.js) uses actual preload, private trusted links or signed bundles, and the public Renderer controller.
Each mode checks three themes and three Cell sizes across default, independent, and restored implementations.
Fifty-four comparisons retain actual desktop consumers and comparison consumers through replacement and restoration.
They compare text, DOM structure, SVG attributes, classes, fonts, colors, and geometry.
Mount guards reject context access after registry adaptation for actual and comparison consumers.
Guards are installed before initial default mounts and cover independent activation, enable, and recovery.
Eighteen lifecycle operations per mode disable and enable each identity across all three phases.
Other tool containers and an active Year peer retain ownership.
Shutdown releases active surfaces, discovery, and signed asset authority before the actual child closes.
The geometry command now includes this isolated replacement gate.

The first browser command failed before launch because the new child fixture was absent.
Both browser modes then passed in 4.52 seconds.
The geometry wiring check failed before the runner included the new gate.
The final affected command passed all forty-six checks without failures or skips in 5.63 seconds.
Fresh source review found that the original empty context Proxy was lost during registry context adaptation.
Controlled subscription entries reproduced this gap through both actual loading modes before the guard repair.
Both controls initially failed because acceptance incorrectly succeeded.
The repaired mount guards reject both controls while both ordinary replacement modes pass.
The four browser checks passed in 7.72 seconds.
The final affected command passed all forty-eight checks without failures or skips in 8.30 seconds.
Fresh follow-up source review confirmed the guard repair and found no remaining actionable issue.
The reviewer did not execute tests.
The style build passed without changing generated CSS.
All 443 local references and heading anchors across four affected documents passed checks.
The complete command passed with 1770 passes, no failures, and two skips in 722.64 seconds.
All twenty-three executable and scenario candidate files remained unchanged.
This command does not include the later Quota surface increment.
Production Main activation checks completed on 2026-10-10 through the existing [Clock startup fixture](../tests/clock-main-bootstrap.test.js).
The calendar case now also installs the three existing desk tool entries under the same scoped publisher policy.
Actual Main runs every plugin with private state and controlled external inputs.
The CLI activates signed tool surfaces and restores built-in implementations without changing saved selections.
Default mount guards and executed entry markers identify independent execution.
Actual containers preserve state text, display-only behavior, DOM structure, and SVG attributes across all three phases.
Fonts and animation frames settle before each structure comparison.
Tick counts, Main port identities, document identity, and the foreground App remain unchanged.
Shutdown releases subscriptions, handlers, signed protocol routes, and private listeners.
Before package installation, the same scenario failed at Settings activation; the completed focused check passed in 22524 milliseconds.
The shared startup, browser, lifecycle, Native management, and Renderer replacement command passed 47 tests without failures or skips in 92610 milliseconds.
Calendar and tool activation share one local test function; no new fixture, test framework, or management interface was added.
The earlier private candidate predates these test changes.
Density, raster pixels, and physical input remain unverified.
No production implementation changed in this increment.

### Native static desk tool acceptance

The existing four browser checks passed on Windows x64 and CM5 Linux arm64 on 2026-10-10.
Windows completed in 7.75 seconds in the logged-in interactive Session 1.
CM5 completed in 26.22 seconds as `orangepi`.
Both commands reported zero failures, cancellations, or skips.
All 186 captured inputs remained unchanged on both hosts and matched the local worktree afterward.
Ordinary development and signed modes each retained fifty-four comparisons and eighteen disable or enable operations.
Both loading modes rejected controlled optional connection subscriptions with the required failure diagnostic.
The checks preserved display-only behavior, state text, DOM structure, SVG attributes, active peers, selected revisions, recovery, and final release.

Two regression cases failed before the hidden-window repair.
They reused the existing Clock and Calendar isolation cases for the desk tool fixture.
The fixture now establishes its content size, renderer viewport, and unit scale after loading and renders offscreen.
Linux uses software rendering without the headless Ozone flag.
All comparison assertions, dependency guards, and deadlines remain unchanged.
An initial local command passed 32 checks, including actual Clock and Calendar loading modes.
That command also named a nonexistent lifecycle file; its pass count does not establish any coverage from that file.
Two obsolete lifecycle arguments and three obsolete Native manager arguments were removed from documentation commands.
Those missing files contribute no coverage to the historical command results.
The corrected affected command passed 59 checks with no failures or skips in 7.65 seconds.
It covered static tool loading, controlled dependency rejection, isolation, runtime replacement, and sequential feature behavior.
A fresh independent source review found no actionable findings; it did not run checks.
The completed Windows acceptance task was removed after terminal confirmation and a task-owned process check.
No task-owned acceptance processes remained on either host.
Production sources, active releases, and services did not change.

These checks establish controlled offscreen DOM, computed-style, geometry, and lifecycle behavior on both hosts.
Independent density, raster pixels, and physical input remain unverified.
These checks do not activate a production release.

Run this current affected command from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/e2e-isolation.test.js tests/desk-tool-surface-electron.test.js tests/widget-sequential-refinement.test.js tests/renderer-runtime-replacement.test.js
```

```sh
node --test --test-concurrency=1 tests/clock-main-bootstrap.test.js tests/calendar-surface-electron.test.js tests/calendar-surface-lifecycle.test.js tests/desk-tool-surface-electron.test.js tests/clock-surface-lifecycle.test.js tests/renderer-runtime-replacement.test.js
```

## Quota independent surface replacement

The [Quota surface contract](QUOTA_SURFACE_PLUGIN_CONTRACT.md) defines reading, refresh, disclosure, and cleanup compatibility.
The independent entry constructs DOM nodes without calling the default factory or its projection helpers.
Static provider artwork, Shell styles, fonts, and the public subscription service remain shared dependencies.
The [browser fixture](../tests/quota-surface-electron.test.js) uses actual preload, private Main IPC, trusted development links, signed bundles, and the public controller.
Both modes retain actual and comparison consumers across replacement and built-in recovery in one document.
Three themes and two viewport sizes produce twelve replacement and restoration comparisons per mode.
Nineteen state cases cover unknown percentages, mixed priorities, partial failure, empty responses, and inert provider text.
Refresh checks cover held responses, controlled rejection, retained accounts, disclosure recovery, focused summaries, and trusted browser Enter input.
Subscription observations begin before initial acquisition and require the initial actual consumer to appear.
Persistent cleanup failure retains both subscriptions until explicit retry.
Late readings and pending refresh completion cannot update released nodes.
Shutdown releases subscriptions, discovery, and signed asset authority before actual child closure.

The original missing child fixture failed before Electron launch.
Actual loading then exposed a preview defect for existing packaged stylesheets.
The regression failed before the loader repair.
Runtime previews now retain the selected Shell path when the package declares no external stylesheet.
Actual definitions still reject changed or missing styles, and external capture bindings cannot be inherited.
Arbitrary external stylesheet loading remains refused.
Rendered comparison also exposed the existing meter fill policy issue described in the surface contract.
The independent entry preserves this baseline; the issue remains unfixed.

Production Main now jointly selects signed Quota source and page implementations through the actual native CLI.
Actual preload and the subscription service publish available, empty, unauthorized, unavailable, and unconfigured responses.
Page readings, accessible meter values, account labels, and recovery messages match default startup.
Authenticated default restoration and activation repeat those responses in the same document and page container.
The source instance, Main lifecycle records, saved configuration bytes, and single active subscription remain unchanged.
An incorrect signed page reading fails an independent expected-value assertion.
A missing page definition triggers the packaged mount guard during actual startup.
Shutdown releases the observed subscription, Main handlers, management listener, and native asset protocol.
These checks retain the existing CSP meter fill limitation; they do not repair or certify visual meter fill.

The current affected command passed 121 tests with zero failures or skips in 28317 milliseconds on 2026-10-10.
The first fixture attempt did not recognize the enabled management plugin; later setup corrected baseline version and publisher identifier expectations.
No production source changed.
This verification increment followed the completed 2044-test full run.
Independent density, real account providers, physical input, and supported-host acceptance remain unverified.

```sh
node --test --test-concurrency=1 tests/quota-main-bootstrap.test.js tests/quota-surface-electron.test.js tests/quota-page.test.js tests/quota-plugin-parity.test.js tests/quota-source.test.js tests/quota-electron.test.js tests/renderer-management.test.js tests/native-renderer-plugins.test.js tests/native-plugin-loader.test.js tests/shared-service-selection.test.js
```

Earlier affected and broader commands passed 56 and 118 checks without failures or skips in 6.20 and 16.64 seconds.
Fresh independent source review found no actionable issue; the reviewer did not execute tests.
Syntax, scoped whitespace, and all 482 local references and heading anchors across five affected documents passed checks.
The style build passed without changing generated CSS.
The geometry command includes the new isolated surface gate; its complete aggregate was not run in this increment.
The complete command finished with 1774 passes, one failure, and two skips in 1205.86 seconds.
All thirty-seven recorded candidate files remained unchanged.
The Weather Main bootstrap child reported successful assertions and handler release, but exceeded its process closure deadline and received `SIGKILL`.
The cause remains unresolved; successful assertions do not establish normal process closure.
The focused Weather Main bootstrap rerun passed in 3.88 seconds.
This rerun does not explain the earlier closure failure or clear the failed complete gate.
This command started before the Pi State Bar checks were added and does not certify that later increment.
Joint Main startup and authenticated activation are recorded above; native offscreen results are recorded below.

### Native Quota surface acceptance

Controlled Quota replacement checks passed on Windows x64 and CM5 Linux arm64 on 2026-10-10.
Both hosts passed development loading and signed loading with zero failures or skips.
Windows completed in 4.59 seconds in the logged-in interactive Session 1.
CM5 completed in 17.39 seconds as `orangepi`.
All 181 captured source, fixture, helper, and package inputs remained unchanged on both hosts and matched the worktree afterward.
Each mode retained twelve comparisons, nineteen provider-state cases, active consumers, and built-in recovery.
Refresh checks retained disclosures, focused summaries, busy state, recovery messages, and trusted browser Enter activation.
Failed cleanup retained both subscriptions until retry; released nodes ignored late callbacks and pending completion.
Final shutdown released subscriptions, discovery, signed protocol routes, and asset authority before actual child closure.

Three regression cases failed before the fixture repair.
They cover offscreen rendering and explicit renderer metrics at both existing comparison sizes.
Each resize now establishes its declared viewport and unit device scale before fonts settle and geometry is measured.
Linux uses software rendering without the headless Ozone flag.
The fixture retains focus emulation, all existing comparisons, state assertions, geometry requirements, and deadlines.
The affected local command passed 69 checks with no failures or skips in 7.14 seconds.
It covered Quota source parity, surface loading, runtime replacement, and isolation.
A fresh independent source review found no actionable findings; the reviewer did not run checks.
The completed Windows acceptance task was removed after terminal confirmation and a task-owned process check.
No task-owned acceptance processes remained on either host.
Production sources, active releases, and product services did not change.

These results establish controlled offscreen DOM, computed-style, geometry, lifecycle, and synthesized trusted keyboard behavior on both hosts.
They preserve the existing CSP meter-fill limitation without certifying correct visual fill.
Independent density, raster pixels, live account providers, physical keyboard input, and display presentation remain unverified.

Run this affected command from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/e2e-isolation.test.js tests/quota-surface-electron.test.js tests/quota-plugin-parity.test.js tests/renderer-runtime-replacement.test.js
```

## Pi State Bar lifecycle and independent projection

The [Pi State Bar contract](PI_STATUS_SURFACE_PLUGIN_CONTRACT.md) defines counts, labels, legacy briefing, cadence, navigation, and release ownership.
An independent entry owns projection and cleanup while sharing static markup, artwork, Shell styles, and public interfaces.
The actual registry and Host checks reject default factory delegation when selecting the independent entry.
Controlled pending requests reproduced five default failures before repair.
They covered late success, late rejection, old requests overwriting replacement readings, and retained navigation listeners.
The default surface now fences released callbacks and removes its button listener through scoped cleanup.
Active readings, briefing parts, source labels, and initial and periodic scan cadence retain parity across nine response cases.
Captured old click callbacks cannot navigate after release.
The affected command passed all sixty-six checks without failures or skips in 1.41 seconds.
The broader command passed all 139 checks without failures or skips in 2.06 seconds.
Fresh independent source review found no actionable issue; the reviewer did not execute tests.
The style build passed without changing generated CSS.
The browser parent initially failed before launch because its child fixture was absent.
Development and signed browser loading now execute the independent entry through actual preload and the public Renderer controller.
Both modes retain the actual State Bar consumer, comparison consumer, document, and active Year peer across replacement and built-in recovery.
Three themes and three comparison sizes produce eighteen replacement and restoration comparisons per mode.
They compare text, accessible names, classes, computed styles, and positive contained geometry.
Eight response cases compare actual and sample readings and legacy briefing parts across all three implementation phases.
Publication observations wait for new results from both consumers when consecutive responses have the same count.
Controlled Tick dispatch does not establish natural elapsed-time progression.
Trusted browser Home selects another page before Enter activates the actual status button and selects Pi Sessions in each phase.
Six lifecycle operations per mode disable and enable each implementation phase.
Tick observations start before initial acquisition and require the actual initial subscription to appear.
Controlled entries without Tick subscriptions are rejected through both actual loading paths.
Fresh source review found that later keyboard phases could pass while Pi Sessions remained selected from the first phase.
Controlled entries without navigation reproduced this gap through both loading modes before the fixture repair.
Both negative controls initially failed because the incomplete entries were accepted.
The repaired checks establish another page before Enter and reject both navigation controls at the destination assertion.
Fresh follow-up source review confirmed the repair and found no remaining actionable issue; the reviewer did not execute tests.
Shutdown releases subscriptions, discovery, and signed asset authority before normal child closure.
The geometry wiring check failed before the new gate was added to the runner.
The final affected command passed all ninety-eight checks without failures or skips in 15.35 seconds.
Syntax, scoped whitespace, contract sentence lengths, and all 450 local references and heading anchors passed checks.
The style build passed without changing generated CSS.
The geometry command includes this isolated browser gate; its complete aggregate was not run in this increment.
The complete command passed with 1791 passes, no failures, and two skips in 695.57 seconds.
All 596 recorded candidate files remained unchanged.
This command excludes the later connection and gamepad increment.
The earlier Weather closure failure remains unexplained despite this successful complete rerun.
Authenticated Main activation, joint source replacement, density, raster pixels, and supported-host acceptance remain unverified.

### Native Pi State Bar acceptance

Controlled Pi State Bar checks passed on Windows x64 and CM5 Linux arm64 on 2026-10-10.
Each host passed six checks with zero failures or skips.
Windows completed in 11.15 seconds in the logged-in interactive Session 1.
CM5 completed in 42.07 seconds as `orangepi`.
All 181 captured source, fixture, helper, and package inputs remained unchanged on both hosts and matched the worktree afterward.
Development and signed loading each retained eighteen comparisons, eight state cases, six lifecycle operations, and built-in recovery.
Both loading paths rejected entries without Tick ownership or navigation behavior at their required assertions.
Trusted browser Home selected another page before Enter activated Pi Sessions.
Shutdown released Tick subscriptions, discovery, and signed asset authority before actual child closure.

Two regression cases failed before the fixture repair.
They cover hidden-window renderer metrics and offscreen rendering.
The fixture now establishes a 1920 by 1280 viewport and unit scale after document loading and before measurement.
Linux uses software rendering without the headless Ozone flag.
Existing behavior, isolation, negative controls, and deadlines remain required.
The affected local command passed 63 checks with no failures or skips in 11.52 seconds.
A fresh independent source review found no actionable findings; the reviewer did not run checks.
The completed Windows acceptance task was removed after terminal confirmation and a task-owned process check.
No task-owned acceptance processes remained on either host.
Production sources, active releases, and product services did not change.

These results establish controlled offscreen DOM, computed-style, geometry, lifecycle, and synthesized trusted keyboard behavior on both hosts.
Natural elapsed Tick progression, real Pi providers, independent density, raster pixels, physical input, and display presentation remain unverified.

Run this affected command from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/e2e-isolation.test.js tests/pi-status-surface-electron.test.js tests/pi-status-surface-lifecycle.test.js tests/renderer-runtime-replacement.test.js
```

## Connection and gamepad status replacements

The [input status contract](INPUT_STATUS_SURFACE_PLUGIN_CONTRACT.md) defines independent projection, input ownership, retained state, and legacy compatibility.
Both independent entries own projection and cleanup while sharing static markup, artwork, styles, and documented input services.
Two default captured-callback regressions failed before the release fences were added.
Default and independent callbacks now stop changing nodes after release or cancellation.

Development links and signed revisions execute through actual preload and the public Renderer controller in one unchanged document.
Resource observations start before initial mounts and require the first actual consumers to appear.
Three themes and actual 320×480, 960×640, and 1920×1280 viewports cover both actual and comparison consumers.
Seven input cases exercise the actual connection service and gamepad polling path.
Fresh review requested actual viewport variation and authority-release assertions before window destruction.
Both changes passed browser checks; follow-up source review found no remaining actionable issue within its scope.
The reviewer did not execute tests.
Discovery and signed asset authority release while the window remains alive; the parent separately waits for actual child closure.
The geometry wiring regression failed before this isolated gate was added to the runner.

A separate browser regression reproduced the missing connected indicator after enable with an unchanged gamepad.
The document-owned gamepad service now retains frozen primitive state and immediately supplies it to subscribers.
Default and independent surfaces use that public service; older contexts retain the existing window event path.
Replacement, restoration, and enable verify connected state without another input event.
Consumer mutation, event-object mutation, subscriber failure, and subscription release have isolated service checks.
Controlled entries without resources or initial replay fail their corresponding guards through both actual loading modes.
The broader command passed all 139 checks without failures or skips in 34.94 seconds.
Fresh independent source review found no actionable issue in the shared state service and consumers; the reviewer did not execute tests.
The style build passed without changing generated CSS.
The geometry command includes this isolated browser gate; its complete aggregate was not run in this increment.
The complete command ended with 1812 checks: 1804 passes, six failures, and two skips in 1826.07 seconds.
All 605 recorded candidate files remained unchanged through completion.
The signed-startup Appearance Main check reported a production verifier timeout.
Five other failed children printed assertion reports but required deadline termination instead of normal closure.
They cover Appearance activation without startup assets, development Calendar, signed Weather revisions, and two WeRead Main states.
These closure failures remain unresolved.
The focused signed-startup repeat reported a production verifier timeout.
Separate process observations then passed both Appearance startup paths and controlled package rejection with actual verifier closure.
The two Calendar modes passed with bounded phase observations and no pending recorded calls.
The focused Appearance activation repeat without startup assets also passed.
These repeats do not explain the earlier failures or clear the complete gate.
Production Main authorization, real input, density, raster pixels, and supported-host acceptance remain unverified.

### Native connection and gamepad status acceptance

Controlled input status checks passed on Windows x64 and CM5 Linux arm64 on 2026-10-10.
Each host passed eight checks with zero failures or skips.
Windows completed in 13.49 seconds in the logged-in interactive Session 1.
CM5 completed in 46.37 seconds as `orangepi`.
All 183 captured source, fixture, helper, and package inputs remained unchanged on both hosts and matched the worktree afterward.
Each loading mode retained thirty-six comparisons, seven input cases, twelve lifecycle operations, and four shared service selections.
Development and signed loading rejected missing connection resources, missing gamepad resources, and missing retained state replay.
Selected shared service readings resisted default events; restoring each service recovered its current reading.
Final shutdown released subscriptions, discovery, signed protocol routes, and asset authority before actual child closure.

Four regression cases failed before the fixture repair.
They cover offscreen rendering and explicit renderer metrics at all three existing comparison sizes.
Each resize now establishes its declared viewport and unit scale before fonts settle and geometry is measured.
Linux uses software rendering without the headless Ozone flag.
Existing behavior, isolation, negative controls, and deadlines remain required.
The affected local command passed 70 checks with no failures or skips in 12.93 seconds.
A fresh independent source review found no actionable findings; the reviewer did not run checks.
The completed Windows acceptance task was removed after terminal confirmation and a task-owned process check.
No task-owned acceptance processes remained on either host.
Production sources, active releases, and product services did not change.

These results establish controlled offscreen DOM, computed-style, geometry, shared service selection, and lifecycle behavior on both hosts.
Real network transitions, physical gamepads, independent density, raster pixels, and display presentation remain unverified.

Run this affected command from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/e2e-isolation.test.js tests/input-status-surface-electron.test.js tests/input-status-surface-lifecycle.test.js tests/gamepad-state-service.test.js tests/renderer-runtime-replacement.test.js
```

## Pre-order independent surface replacement

The [replacement scenarios](../tests/features/preorder-surface-replacement.feature) define countdown compatibility and released callback isolation.
The [lifecycle checks](../tests/preorder-surface-lifecycle.test.js) reproduced three default failures before repair.
Late image and Tick callbacks change disabled or unmounted surfaces despite subscription release.
The independent entry owns countdown, crop calculation, Pixel processing, and callback fences.
It shares static markup, artwork, and Shell styles.
The initial Node command reported seven passes and three default lifecycle failures.
A further regression covers failed Tick release without factory shutdown.
The default release fences pass the lifecycle and geometry wiring checks.
Passing cases cover opening boundaries, exact crop parameters, partial Pixel blocks, buffer rejection, release isolation, and cleanup retry.
Actual artwork dimensions reproduced crop rounding differences before the independent calculation was repaired.
Development and signed browser cases exercise actual preload, external discovery, replacement, restoration, and disable and enable.
Three themes and actual 320×480, 960×640, and 1920×1280 viewports compare canvas digests and text boundaries.
Tick observations start before the first actual mount and retain the unrelated Year surface.
Static comparisons drive observed callbacks after layout, stylesheet, and pending image completion.
Separate countdown transitions use the actual shared timer.
Controlled entries without Tick subscription or Pixel processing must fail their corresponding guards through both loading modes.
The initial nineteen affected checks passed before additional browser enable and text-boundary checks were added.
Those additions exposed pixel differences between default and restored canvases with matching recorded draw inputs.
A focused software-raster repeat passed without pixel tolerance changes.
The current browser fixture explicitly selects software rasterization; GPU presentation remains unverified.
The broader rerun passed all 124 checks without failures or skips in 26.91 seconds.
The final affected command passed all nineteen checks in 26.01 seconds, including the explicit software-rendering assertion.
The style build passed without changing generated CSS.
Syntax, scoped whitespace, new contract sentence lengths, and all 456 local file references passed checks.
The geometry command includes this isolated browser gate; its complete aggregate was not run in this increment.
Fresh independent review found no actionable issues within this increment.
The reviewer independently ran all nineteen affected checks with no failures or skips.
The earlier complete command excludes these newly added Pre-order checks, fixtures, and subsequent repairs.
The new complete command finished with 1831 checks: 1827 passes, two failures, and two skips in 735.63 seconds.
All 611 candidate files remained unchanged through completion.
Both Appearance startup modes reported production verifier timeouts.
A separate observed-runner repeat passed both startup modes and controlled rejection with normal child closure.
This repeat does not explain the complete-command failures.
The five earlier process closure failures did not recur; their cause remains unexplained.
This command excludes the subsequent installed-runtime pending-operation repair.
Production Main activation checks completed on 2026-10-10 through the existing [Clock startup fixture](../tests/clock-main-bootstrap.test.js).
The same calendar and static tool case now also installs the existing independent Pre-order entry under its scoped publisher policy.
Actual Main runs every plugin with private state and controlled external inputs.
The CLI activates the signed surface and restores its built-in implementation without changing saved selections.
Executed entry markers and default mount guards identify independent execution.
The same actual container preserves countdown, opening state, caption, `aria-live`, and exact canvas PNG digests across three phases.
Two controlled times per phase produce six countdown comparisons at `1920x1280` with unit scale and software rasterization.
Instrument measures one hour before opening; Border Beam measures the opening instant.
Draw observation starts before initial Shell mounting and must observe each current canvas.
Comparisons wait for text, fonts, layout, and an actual shared timer draw after a theme change.
An initial comparison used canvases drawn at different layout sizes; aligning redraw inputs removed that fixture discrepancy without product or tolerance changes.
The existing absence of redraw on resize alone remains unchanged.
Shared Shell assertions retain Tick counts, Main ports, the document, foreground App, and Clock placement.
Shutdown releases subscriptions, handlers, signed protocol routes, and private listeners.
Before package installation, the same scenario failed at Pre-order activation; the completed aligned focused check passed in 33794 milliseconds.
After shared assertion refactoring, the affected command passed 66 tests without failures or skips in 128597 milliseconds.
It includes calendar, static tools, Clock, Pre-order, Native management, and Renderer replacement checks.
The existing Pre-order browser matrix retains both controlled missing-subscription and missing-Pixel rejection cases.
No production source, test framework, management interface, or separate startup fixture was added.
Density, GPU presentation, physical input, and supported-host results remain unverified.

```sh
node --test --test-concurrency=1 tests/clock-main-bootstrap.test.js tests/calendar-surface-electron.test.js tests/calendar-surface-lifecycle.test.js tests/desk-tool-surface-electron.test.js tests/clock-surface-lifecycle.test.js tests/preorder-surface-electron.test.js tests/preorder-surface-lifecycle.test.js tests/renderer-runtime-replacement.test.js
```

### Native Pre-order surface acceptance

Controlled Pre-order checks passed on Windows x64 and CM5 Linux arm64 on 2026-10-10.
Each host passed six checks with zero failures or skips.
Windows completed in 24.32 seconds in the logged-in interactive Session 1.
CM5 completed in 58.25 seconds as `orangepi`.
All 181 captured source, fixture, helper, and package inputs remained unchanged on both hosts and matched the worktree afterward.
Each loading mode retained eighteen comparisons, six shared timer updates, three enable cycles, and built-in recovery.
Canvas comparisons retained dimensions, nonempty pixels, exact digests, drawing inputs, and uniform Pixel blocks.
The actual shared timer drove controlled Date transitions across default, independent, and restored implementations.
Development and signed loading rejected entries without Tick ownership or Pixel processing at the required assertions.
Final shutdown released Tick subscriptions, discovery, signed protocol routes, and asset authority before actual child closure.

Four regression cases failed before the fixture repair.
They cover offscreen rendering and explicit renderer metrics at all three existing comparison sizes.
Each resize now establishes its declared viewport and unit scale before existing layout and drawing synchronization.
The fixture retains its existing software rasterization, negative controls, geometry requirements, and deadlines.
The affected local command passed 75 checks with no failures or skips in 26.20 seconds.
A fresh independent source review found no actionable findings; the reviewer did not run checks.
The completed Windows acceptance task was removed after terminal confirmation and a task-owned process check.
No task-owned acceptance processes remained on either host.
Production sources, active releases, and product services did not change.

These results establish controlled software Canvas pixels, countdown updates, geometry, replacement, recovery, and lifecycle behavior on both hosts.
Independent density, GPU presentation, physical input, and display presentation remain unverified.

Run this affected command from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/e2e-isolation.test.js tests/preorder-surface-electron.test.js tests/preorder-surface-lifecycle.test.js tests/renderer-runtime-replacement.test.js
```

## Installed runtime pending operations

The [runtime release contract](USER_APPLICATIONS.md#runtime-release) defines admission, accepted operations, child closure, and cleanup retry.
An isolated Node observation reproduced cleanup completing before an accepted installation finished.
The old operation then wrote the installed catalog and published one change notification.
Five pending-operation regressions failed before repair.
The runtime now retains accepted operations and refuses stopped request callbacks.
Fresh review found unowned initial data synchronization and verifier verdicts that preceded actual child closure.
Seven further regressions failed before those ownership repairs.
Initial synchronization now remains owned through Host cleanup.
The verifier separately retains child closure after timeout, abort, output-limit failure, and synchronous cancellation during spawn.
Runtime cleanup drains verifier ownership before releasing handlers, routes, listeners, and dependencies.
The broader command passed all 197 checks without failures or skips in 11.31 seconds.
A real hostile Electron verifier closed before its explicit release completed.
Fresh follow-up review found both findings resolved and no additional material issue in the reviewed paths.
The reviewer independently ran all 52 affected checks without failures.
The complete command above excludes these later repairs.
The new complete command passed with 1844 passes, no failures, and two skips in 708.93 seconds.
All 613 candidate files retained their captured hashes through completion.
This successful rerun does not explain the earlier Appearance verification timeouts.
Appearance timeout diagnosis and supported-host acceptance remain open.

## Independent App Manager navigation

The [App Manager contract](APP_MANAGER_PLUGIN_CONTRACT.md) defines state, foreground, trace, and recovery compatibility.
The [replacement scenarios](../tests/features/app-manager-replacement.feature) cover independent loading, navigation, lifecycle, and recovery.
The fixture now owns its state transitions without importing or copying the default manager algorithm.
It shares static catalog metadata and public Host interfaces.
Actual CLI installation and development linking use private state and explicit grants.
Signed loading retains captured modules after stored files change.
Default construction fails when a replacement executes.
The existing signed selection checks now exercise the independent implementation.

A new regular [browser entry](../tests/app-manager-electron.test.js) executes actual preload and Host-owned IPC handlers.
Browser pointer Back and keyboard Escape close Apps and restore the original focus target.
Catalog search and failed mount recovery retain existing behavior.
Renderer resources and Main handlers release before the hidden window closes.
The parent waits for actual child closure before removing its private profile and bundle directories.
Successful children use normal application shutdown.
Controlled replacements that omit rollback fail the recovery assertion through both loading modes.
An initial failure path printed assertions but returned success; explicit failure exit now preserves the failed verdict after cleanup.

The deterministic sequence check compares 9000 operations and each resulting catalog, foreground, and individual state.
Fresh review found biased low-bit sampling before its repair.
Upper-bit sampling and explicit value coverage now include every declared choice.
Separate product assertions cover UI foreground exclusion, valid and invalid recovery, service behavior, and capability-array isolation.
The final affected command passed all 104 checks without failures or skips in 4.65 seconds.
Fresh independent review found no outstanding findings and independently passed all 21 focused checks.
Authenticated production Main startup, runtime foreground handoff, physical input, supported hosts, and assistive technology remain unverified.
The complete App Manager command passed with 1855 passes, no failures, and two skips in 683.28 seconds.
All 618 candidate files retained their captured hashes through completion.
This successful rerun does not explain earlier Appearance verification timeouts.

## App Manager runtime state handoff regression

An isolated actual Host check starts Clock and removes Pomodoro before replacing the default manager with the independent signed definition.
Replacement clears the foreground, resets Clock from running to installed, and restores Pomodoro in the visible catalog.
Three preservation assertions fail before repair: direct replacement, failed candidate recovery, and actual Native activation.
Failed candidate recovery restores the original factory but loses its paused foreground and removed catalog state.
Native activation reports running after the same state loss.
This confirms a runtime state handoff gap beyond startup and browser navigation acceptance.
These isolated regressions remain outside the completed candidate and have no repair.
No production change or runtime compatibility repair is claimed for this observation.

## Production Main App Manager startup

The [regular production Main entry](../tests/app-manager-main-bootstrap.test.js) uses four independent Electron processes and private configuration, profiles, state, and workspace directories.
Default, signed, development, and corrupt signed selections exercise actual Main composition and the packaged preload.
The default construction guard refuses fallback when an independent implementation should run.
The controlled corrupt selection starts the default implementation and records the expected bounded loader warning.
A shared navigation helper checks catalog search, pointer Back, keyboard Escape, focus restoration, and mount recovery through the actual consumer.
Each process checks all production handlers and Host resources during normal shutdown.
The parent waits for child closure before deleting the private directory.
Unrelated Main plugins and desktop surfaces remain disabled.
This isolation excludes live providers and physical devices.

The new regular entry failed before the production Main child fixture existed.
The external prototype passed before repository integration.
The affected repository command passed all 39 checks without failures or skips in 6.87 seconds.
Fresh independent review found no actionable issue and independently passed all five focused checks.
The broader command passed all 105 checks without failures or skips in 9.63 seconds.
The final focused rerun also passed after helper formatting and import cleanup.
The preceding 618-file complete candidate excludes this later test increment.
Runtime state handoff remains a reproduced failure; startup equivalence does not repair it.

## App Manager state handoff repair

The [handoff scenarios](../tests/features/app-manager-replacement.feature) define successful replacement, failed candidate recovery, and atomic state validation.
Three actual Host and Native activation regressions reproduced cleared foreground state and restored removed Apps before repair.
Six App Manager regressions failed before snapshot methods and released IPC admission guards existed.

The Host now stages detached state for all affected instances before old resources release.
Compatible candidate restoration completes before startup and public port publication.
Rollback receives a separate clone of the original snapshot.
Failed old or candidate cleanup retains recovery state for explicit replacement retry.
Ordinary disable and enable still create fresh state.
The trusted loading wrapper now forwards state hooks through both Native and development loading.
The first affected run exposed this missing forwarding path; signed replacement and Native activation passed after repair.

A further regression reproduced stale provider snapshots when another affected capture failed.
Snapshot staging now commits only after every capture succeeds.
Two pending-work regressions reproduced premature refusal of unsupported asynchronous state hooks.
Refusal now waits for actual settlement before cleanup or recovery.
All thirteen Host state checks pass.
The final affected command passed all 159 checks without failures or skips in 10.75 seconds.
An additional mixed-provider check passed with the other twelve Host state checks in 0.15 seconds.
Stateful consumers retain their state across legacy provider replacement and failed candidate recovery.
Complete Host restart still creates fresh consumer state.
Fresh independent review found no actionable issue and independently passed 114 Node checks.

Actual production Main checks use the authenticated CLI, private management listener, actual preload, and retained Clock document and surface.
Signed activation and built-in recovery preserve manager state, removed Pomodoro, and saved configuration bytes.
A controlled candidate restoration failure returns activation-failed and restores the same built-in state.
Browser Escape still closes the retained foreground after recovery.
The three production Main checks passed without skips in 4.63 seconds.
Fresh follow-up review independently passed those three checks with no actionable findings.

The earlier 618-file complete gate excludes this repair.
The repaired 623-file candidate passed the complete Shell test command in 701.27 seconds.
It passed 1,877 of 1,879 checks, with zero failures and two skips.
All captured files retained their hashes, and the candidate file inventory stayed unchanged through completion.
Hookless legacy migration, supported hosts, physical input, and assistive technology remain unverified.

## App Manager enabled Main composition

The [production Main entry](../tests/app-manager-main-bootstrap.test.js) now enables all 28 Main plugins in two additional private fixtures.
Both fixtures mount the configured desktop surfaces instead of disabling them.
The actual CLI activates the signed manager, restores the built-in manager, or receives a controlled restoration failure.
Complete manager state, saved configuration, foreground surface, peer ports, and mounted desktop nodes remain unchanged.
Normal shutdown removes IPC handlers and the five private management, diagnosis, application, and data listeners.

The [isolation helper](../tests/helpers/app-manager-composition-isolation.js) retains actual source algorithms with controlled unavailable external inputs.
Its controlled inputs prevent camera capture, account configuration lookup, and local Pi inspection.
Its Main-process socket guard rejects TCP connections and sockets outside private state.
This guard does not sandbox Chromium or child-process network access.
Controlled forbidden connections fail before the native socket implementation executes.
No live external service or physical input is exercised.

The first run exposed a fixture selector quoting error; its correction changed no product implementation.
All five production Main checks then passed in 6.54 seconds.
The final affected command passed all 35 checks without failures or skips in 11.74 seconds.
Fresh independent review found no actionable issue and independently passed all five Main checks in 7.01 seconds.
The earlier 623-file complete gate includes the product repair but excludes this later test-only composition increment.
Live-provider composition, supported hosts, physical input, and assistive technology remain unverified.

## Clock authenticated production Main activation

The [production Main checks](../tests/clock-main-bootstrap.test.js) start with either the built-in Clock or an independently signed Clock.
Both startup states use the same checks with default and selected Renderer control channel owners.
The selected owner loads through an actual trusted development CLI link.
Its entry marker, version, and default factory guard verify actual selection before activation.
All 28 Main plugins run with private state and controlled unavailable external inputs.
The fixture primes one blank document before installing controlled Date and subscription observations.
The actual Shell document then loads once, with no navigation during implementation changes.

Authenticated CLI activation selects signed versions 2.0.0 and 3.0.0 through the production Renderer management route.
Built-in recovery succeeds with malformed external configuration and revoked publisher trust while preserving those files.
Activation receipts match the saved revision and executed entry marker.
The same desktop placement, foreground App node, Main ports, manager state, and peer desktop nodes remain owned.
Twelve theme comparisons per positive fixture preserve markup, time, computed text styles, and geometry.
Eight shared timer transitions per fixture preserve controlled forward and backward time changes.
The subscription observer starts before initial Shell acquisition and returns to zero after Renderer shutdown.
Scoped comparison motion controls are verified and removed after each measurement.
Normal process shutdown releases handlers, protocol routes, and five private listeners.

A controlled candidate omits Tick ownership and fails the subscription assertion through the same activation path.
A missing selected control owner fails the startup guard before activation.
The affected command passed 58 tests, including all six Main cases, without failures or skips in 54185 milliseconds.

```sh
node --test --test-concurrency=1 tests/clock-main-bootstrap.test.js tests/renderer-management.test.js tests/renderer-control-bridge.test.js tests/native-renderer-activation.test.js tests/main-plugin-replacement.test.js
```

Run the command from `runtime/shell/`.
The [current status](#scope-and-status) owns the complete Shell result and later test input changes.
Independent density, raster pixels, real clock progression, timezone changes, physical input, and supported-host acceptance remain unverified.


## Native Weather and WeRead investigation

The existing surface commands each select development and signed alternatives through actual discovery, preload, and public reading consumers.
Their matrices retain five viewport sizes, three themes, density assertions, and the applicable state, cover, keyboard, and cleanup checks.
The first native command failed all four cases on Windows and CM5 at the existing forty-five-second fixture deadline.
All 266 captured inputs remained unchanged.

Twelve new regressions reproduced missing hidden rendering and post-load viewport controls before repair.
The fixtures now render offscreen and establish requested dimensions, unit device scale, and unit page zoom after every document load.
Temporary debugger sessions close before the separate WeRead keyboard checks.
The actual document dimensions and device scale must match before measurements.
Windows then passed all four cases in 72.44 seconds, but CM5 still failed all four cases.
An interrupted local command reported 63 passes, one failure, and three cancellations; system logs recorded sleep during that command.
That command does not establish successful local verification.

Six additional regressions failed before Linux software rendering was selected before Electron readiness.
The final local affected command passed all 73 checks without failures, cancellations, or skips in 236.20 seconds.
It includes every existing parent that directly consumes either changed Electron fixture.
Windows repeated all four surface cases successfully in 76.38 seconds in interactive Session 1.
CM5 repeated all four cases unsuccessfully in 186.81 seconds; each reached the existing fixture deadline.
All 267 captured inputs remained unchanged on both hosts and matched the current worktree afterward.
The Windows tasks were removed after terminal receipts; no task-owned acceptance processes remained.
Fresh independent source review found no actionable issue; the reviewer did not run checks.
Production sources, active releases, density tolerances, local readiness deadlines, and aggregate fixture deadlines did not change.

A separate controlled CM5 Weather diagnostic retained all assertions and the same deadline.
The default fifteen size and theme combinations completed at 27.48 seconds.
The selected implementation completed eight combinations by 43.77 seconds and loaded its ninth document by 44.81 seconds.
The aggregate watchdog then ended the process before the complete selected matrix finished.
These observations establish continuing work before the cutoff, not a passing complete matrix or a product performance guarantee.
The focused diagnostic failed in 46.65 seconds; all 269 captured inputs remained unchanged.
Diagnostic-only files were removed from the private candidate after terminal and process checks; local evidence remains available.
These diagnostic commands did not establish CM5 completion, physical input, raster presentation, or live-provider behavior.

A separate WeRead diagnostic completed its default fifteen combinations at 35.12 seconds.
Its selected implementation completed three combinations at 43.65 seconds and loaded its fourth document at 44.68 seconds before the same cutoff.
That diagnostic failed in 46.74 seconds; all 269 captured inputs remained unchanged.
Its diagnostic-only files were removed after terminal and process checks.
Independent review found no product requirement for a complete matrix within forty-five seconds.
Each full comparison intentionally loads thirty documents; source-only revision fixtures load fifteen.
The fixtures retain those loads and all existing assertions.

Only complete Linux matrices now use the following fixed aggregate budgets, in seconds.
The child deadline includes closure; the ordinary parent includes preparation, and the surface revision parent includes four serial child runs.

| Matrix | Fixture | Child | Ordinary parent | Surface revision parent |
| --- | ---: | ---: | ---: | ---: |
| Weather | 75 | 85 | 120 | 360 |
| WeRead | 90 | 100 | 130 | 420 |

Source-only revision fixtures retain forty-five-second watchdogs and their existing parent limits.
Other hosts retain their existing aggregate budgets; four-second readiness and ten-second CLI checks remain unchanged.
Fourteen of twenty-four budget regressions failed before implementation; ten already passed through unchanged paths.
The VM check required an explicit simulated platform binding; the corrected budget command passed all twenty-four checks.
Fresh independent source review found no actionable issue in the final budget wiring; the reviewer did not run checks.
The final local affected command passed all 97 checks without failures, cancellations, or skips in 236.91 seconds.
The final Windows and CM5 commands each passed four surface cases and twenty-four budget regressions without failures, cancellations, or skips.
Windows ran in interactive Session 1 and completed in 76.64 seconds; CM5 completed in 253.53 seconds.
CM5 Weather development and signed paths completed in 56.59 and 55.91 seconds.
CM5 WeRead development and signed paths completed in 70.43 and 69.78 seconds.
All 274 captured inputs remained unchanged on both hosts and matched the worktree afterward.
The Windows task was removed after its terminal receipt; neither host retained task-owned acceptance processes.
These complete surface results supersede the failed native commands above for the final candidate.
Physical input, raster presentation, and live-provider behavior remain unverified.
The full Shell command was not repeated after these fixture changes.

Run the affected command from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/reading-surface-timeouts.test.js tests/e2e-isolation.test.js tests/weather-surface-electron.test.js tests/weread-surface-electron.test.js tests/weather-electron.test.js tests/weread-electron.test.js tests/weather-restart-electron.test.js tests/weread-restart-electron.test.js tests/weather-surface-restart.test.js tests/weread-surface-restart.test.js
```

## Remaining completion gates

1. Each product feature needs a mapped plugin owner and default behavior scenario.
2. Every feature needs a working replacement path and end-to-end parity evidence beyond declaration checks.
3. Runtime inventories need explicit host identity, lifecycle state, and health coverage.
4. Applicable development loading and production distribution paths need their existing trust and revision checks.
5. CM5, Windows, and macOS need separate Shell behavior results.
6. S3 and P4 need separate physical acceptance results.

Deployment, activation, service installation, flashing, and live capture require operational authorization.
Missing authorization or hardware evidence leaves the applicable gate unverified.
It does not invalidate completed local checks or permit a completion claim.

Weather now has an independent source algorithm with default, linked, and signed consumer and resource scenarios.
The independent Weather section above records shared dependencies, current evidence, and the relocation limitation.
Use the [feature matrix](PLUGIN_FEATURE_MATRIX.md) to choose a named missing selection or consumer scenario before extending implementation or acceptance infrastructure.
Python named-pipe diagnosis and firmware operator transport remain open without superseding replacement acceptance.

## Dashboard released callback ownership

The default Dashboard now rejects briefing and Tick updates after its placement releases or its Host signal aborts.
The local release fence runs before subscription cleanup.
Failed unsubscribe retains cleanup ownership without retaining permission to update the page.
Current callbacks still update the remounted placement.

[Scenarios](../tests/features/agent-home.feature) define the released callback contract.
[Registry checks](../tests/dashboard-lifecycle.test.js) cover reused containers, former nodes, individual placement release, and failed unsubscribe retry.
[Electron checks](../tests/dashboard-lifecycle-electron.test.js) exercise the actual Shell document, preload, registry, and default Dashboard.
They retain the document and Clock placement across Dashboard disable, retry, and enable.
The fixture also releases an individual Dashboard placement while the plugin remains running.
The parent removes its private profile after the child closes.
Controlled subscriptions supply briefing frames and dates; HTTP requests and permission requests are denied.

The current worktree reproduced three failures before the fix.
The affected command passed 90 tests with no failures or skips.
It covered Dashboard, Agent Home services, Renderer Host, runtime replacement, runtime control, management, stylesheet recovery, and pixel icons.
A fresh independent reviewer found no actionable findings and passed five focused tests, including Electron.

These results establish local callback isolation, not an independent Dashboard implementation.
The independent surface section below records subsequent local placement, foreground, and Back replacement evidence.
Live providers, physical input, Windows, and CM5 were not tested by this increment.
The earlier full-suite result does not certify this changed production candidate.

## Independent Dashboard surface

[The contract](DASHBOARD_SURFACE_PLUGIN_CONTRACT.md) records ownership, shared dependencies, and acceptance limits.
[The browser command](../tests/dashboard-surface-electron.test.js) passed both development and signed positive paths and both controlled invalid candidates.
Each positive path compared ten briefing frames across three themes during independent replacement and built-in recovery.
Each path completed sixty comparisons in one Shell document.
The checks retained the Today container, neighboring Clock placement, selected page, and foreground Clock App node.
Three browser pointer Back operations and three Sources disclosure operations passed per positive path.
Six controlled date transitions passed per positive path through the shared Tick.
Callbacks captured from released implementations could not change the active placement.
Final cleanup released observed briefing subscriptions, discovery handlers, App Manager handlers, and signed asset access.
Private profile removal followed child closure.

The first comparison found static markup indentation differences in parent text content.
The comparison now checks leaf text and complete narrative text, with element geometry and styles unchanged.
It does not discard briefing whitespace or widen geometry tolerances.
Invalid candidates change the empty message before linking or signing.
Both candidates loaded and failed specifically at the independent Instrument empty-frame comparison.
An earlier missing-harness failure established no runtime acceptance.

The affected command passed 94 tests with no failures or skips in 21.89 seconds.
It covered the new browser paths and the previous Dashboard, Renderer lifecycle, control, management, stylesheet, and icon checks.
Independent review identified missing actual-page comparisons and missing checks on retained former nodes.
The revised fixture compares actual Today semantics for every frame and theme.
It checks Sources by pointer on Today after Back and dates on both placements.
It retains former nodes and verifies that released callbacks cannot change them.
Additional invalid candidates target a blank actual page and updates to released nodes.
The first revised run passed six of eight tests.
The two released-callback controls failed because Electron concealed the renderer exception message.
The fixture now returns bounded renderer errors before checking the exact rejection boundary.
The extra placement is hidden during the actual Sources pointer check to avoid obscuring its target.
The fixture verifies target visibility and removes that control before later assertions.
The final affected rerun passed 98 tests with no failures or skips in 36.58 seconds.
All eight Dashboard loading and invalid-candidate scenarios passed through their intended boundaries.
A fresh independent rerun passed all eight scenarios in 33.92 seconds and confirmed both review findings resolved.
The independent fixture shares static icon artwork, Shell styles, fonts, the icon adapter, and provider services.
Main composition uses the actual App Manager with unrelated Main plugins disabled.
The production Main section below records subsequent authenticated activation evidence.
Independent density, live sources, installed App pages, Windows, and CM5 remain open.
This test-only increment does not extend the earlier full-suite result to the production Dashboard repair.

### Native Dashboard surface acceptance

Controlled Dashboard checks passed on Windows x64 and CM5 Linux arm64 on 2026-10-10.
Each host passed eight checks with zero failures or skips.
Windows completed in 33.80 seconds in the logged-in interactive Session 1.
CM5 completed in 73.38 seconds as `orangepi`.
All 181 captured source, fixture, helper, and package inputs remained unchanged on both hosts and matched the worktree afterward.
Each loading mode retained sixty comparisons across ten briefing frames and three themes.
Actual Today content and the comparison placement retained matching semantics, geometry, and literal text.
The document, Today container, selected page, Clock placement, and foreground Clock App remained retained across replacement and recovery.
Three pointer Back operations, three Sources disclosure operations, and six shared timer date transitions passed per positive mode.
Development and signed loading rejected changed messages, missing actual placement behavior, and updates to released nodes at their required assertions.
Shutdown released subscriptions, App Manager handlers, discovery, signed protocol routes, and asset authority.

Two regression cases failed before the fixture repair.
They cover hidden-window renderer metrics and offscreen rendering.
The fixture now establishes a 1920 by 1280 viewport and unit scale after document loading and before measurement.
Linux uses software rendering without the headless Ozone flag.
Existing behavior, isolation, negative controls, and deadlines remain required.
The affected local command passed 70 checks with no failures or skips in 35.18 seconds.
A fresh independent source review found no actionable findings; the reviewer did not run checks.
The completed Windows acceptance task was removed after terminal confirmation and a task-owned process check.
No task-owned acceptance processes remained on either host.
Production sources, active releases, and product services did not change.

These results establish controlled offscreen DOM, computed-style, geometry, lifecycle, and synthesized pointer behavior on both hosts.
Independent density, raster pixels, live briefing providers, physical input, and display presentation remain unverified.

Run this affected command from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/e2e-isolation.test.js tests/dashboard-surface-electron.test.js tests/dashboard-lifecycle.test.js tests/renderer-runtime-replacement.test.js
```

## Dashboard authenticated production Main activation

[Main acceptance](../tests/dashboard-main-bootstrap.test.js) runs the actual production Main entry and preload with every Main plugin enabled.
External inputs use the existing private composition isolation helper.
Both built-in and signed startup paths activate signed version 2, restore the built-in page, reactivate version 2, and activate version 3.
The native update changes saved selection before the final authenticated activation.
Receipts identify the exact stored revision; entry markers identify the executed version.
The fixture forbids default Dashboard mount delegation while external entries run.
Restoration succeeds with malformed external configuration and revoked publisher trust, preserving both private files during recovery.

Each positive path performs 120 frame comparisons and eight controlled forward or backward date transitions.
The ten frames cover live facts, loading, stale, empty, unavailable, error, signed portfolio changes, literal markup, and omitted sources.
Comparisons cover three themes, literal content, source messages, icon paths, computed styles, and actual Today geometry.
Product assertions check literal rendering, portfolio directions, Sources availability, and narrative containment.
The Shell document, Today container, selected page, foreground Clock App node, peers, Main ports, and App Manager state remain unchanged.
Briefing and Tick acquisition observations start before the initial Shell document loads.
Observed owner counts remain stable through each activation and reach zero after Renderer shutdown.
The negative signed candidate omits its briefing subscription and fails specifically at the ownership assertion after authenticated activation.

The fixture uses one blank priming document before one actual Shell document.
Hidden-window comparisons settle fonts and force layout without animation-frame scheduling.
Scoped motion controls are removed after each measurement.
The helper restricts Main socket connections and controls provider inputs; it is not a general subprocess sandbox.
The fixture separately denies Chromium HTTP requests.
Escape closes the foreground App after activation.
Normal shutdown stops all Main plugins, clears handlers, and releases the native protocol.
The parent verifies five private listeners are absent after child closure, then removes private state.

The first attempt had an incomplete fixture and established no runtime acceptance.
A missing harness process was terminated; later incomplete harness processes exited before parent cleanup.
The first implemented run failed because a fixture statement block was placed where an expression was required.
That setup failure reproduced no product defect.
The corrected focused command passed all three scenarios with no skips in 18.62 seconds.
A fresh independent reviewer passed the three scenarios with no skips and found no actionable findings.
The complete affected command passed 109 tests with no failures or skips in 82.76 seconds.
It included Dashboard, Clock and App Manager Main paths, browser replacements, lifecycle, Renderer management, stylesheet recovery, and icons.
Production source files were not changed by this increment.
The earlier full-suite result does not certify the preceding production Dashboard lifecycle repair.
Before the native extension below, independent density, live provider behavior, physical input, Windows, and CM5 remained unverified.


## Native service coordinator acceptance

The refresh, notification, and frame status checks passed on CM5 and macOS on 2026-10-11.
Both commands passed 20 checks without failures or skips.
CM5 used Node 24.16.0 as the `orangepi` service owner in a private candidate.
The native test command completed in 371 milliseconds; the local command completed in 143 milliseconds.
Both commands retained all 673 captured inputs unchanged.
No task-owned acceptance process remained on CM5 after completion.

The command ran from the candidate Shell directory:

```sh
node --unhandled-rejections=strict --test --test-concurrency=1 tests/service-reading-plugins.test.js tests/system-channel-plugins.test.js
```

The [refresh comparison](../tests/service-reading-plugins.test.js) selects default and independent coordinators through the existing Main factory composition.
It verifies declared reading reconciliation, provider withdrawal, failure isolation, and provider order.
Overlapping refresh requests share their active operation.
Shutdown and provider disable wait for that operation before releasing the provider.
Retained timer callbacks cannot refresh after shutdown.

The [channel comparison](../tests/system-channel-plugins.test.js) preserves notification identities and provider return values.
Disable makes retained notification ports inert; enable obtains a fresh port.
Frame messages retain their destinations and unavailable states while providers stop and restart.
Frame subscriptions release on disable and shutdown; retained callbacks cannot broadcast after disable.
The same command checks client cleanup retries, proposal guards, Remote events, and optional-client smoke behavior.

These fixtures run the actual Plugin Host with controlled capabilities and independently selected coordinator factories.
They do not start Electron or connect live providers.
Earlier Main composition checks retain their separate results.
Windows coordinator checks, live providers, and physical interaction remain unverified by this command.
No product source changed.


## Native selected registry reading bounds

The extended Open DeskOS Data comparison passed locally and on CM5 on 2026-10-11.
The [shared scenario](../tests/features/odk-data.feature) retains source errors and byte bounds through default and signed selected registries.
The [consumer comparison](../tests/odk-data-replacement.test.js) reads through the actual control and Personal Bot Link.
It verifies the selected version and prevents default registry construction during signed selection.

Both consumers receive the complete value at the existing 65536-byte UTF-8 value limit.
Both refuse values that exceed that limit by one byte or three bytes.
Source exceptions retain the existing `reading-unavailable` error.
Another source remains readable after failure.
Recovery returns the new stale value and timestamp.
An acquisition counter requires a fresh source read for each consumer request.
Listing does not acquire source readings, and shutdown closes the private Link.

The first new comparison failed because the fixture still supplied its fixed reading.
The fixture now accepts a controlled reader while retaining its previous default.
Fresh review found no findings after explicit selection and one-byte overflow assertions were added.
No product source changed.

CM5 had restarted, so the preceding temporary dependency candidate was unavailable.
The new private candidate installed locked Bot dependencies as `orangepi` with pnpm 11.22.0.
The first installation wrapper failed because its working directory remained `/root`.
The corrected wrapper installed dependencies but returned nonzero because pnpm rejected three unapproved dependency build scripts.
Those scripts were not approved; the required runtime imports and affected tests succeeded without them.
This result does not certify those dependency builds or live SDK execution.

The final command ran from the candidate Shell directory:

```sh
node --unhandled-rejections=strict --test --test-concurrency=1 tests/odk-data-replacement.test.js tests/odk-data.test.js tests/odk-data-shell.test.js tests/odk-data-wiring.test.js
```

Both final commands passed 74 checks without failures or skips.
CM5 completed the tests in 6782 milliseconds; the local command completed them in 2355 milliseconds.
Both commands retained all 822 captured Shell and Bot inputs unchanged.
No task-owned acceptance process remained on CM5 after completion.
The wiring checks use controlled Electron objects; this command does not establish complete Electron startup or live provider integration.
Windows did not run this extension.


## Native Dashboard Main acceptance

The [production Main scenarios](../tests/dashboard-main-bootstrap.test.js) passed locally and on CM5 on 2026-10-11.
Both final commands passed three checks without failures or skips.
CM5 completed the tests in 32970 milliseconds; the local command completed them in 35161 milliseconds.
Both retained all 673 captured inputs unchanged.
No task-owned acceptance process remained on either host after completion.

Each positive path verifies 120 frame comparisons and eight date transitions through actual Main and preload.
The paths retain authenticated activation, built-in recovery, signed updates, peer identities, foreground App state, and subscription ownership.
The negative signed candidate still fails at the briefing ownership assertion after authenticated activation.
The parent observes actual child closure before checking private listener removal.

The first CM5 command passed two checks and failed the built-in startup comparison.
Its built-in baseline contained an unavailable message where the later selected comparison contained an empty message.
The actual Bot client had an absent socket and could publish unavailable states while controlled briefing frames were being measured.
The fixture now retains the actual client with its external transport disabled during injected frame comparisons.
It asserts that exactly one client is constructed.
A post-font check rejects a controlled frame displaced during measurement.
This input control removes the identified interference path; the earlier failure did not record the exact arrival order.

An initial local wrapper used the Linux executable override and failed before Electron launch.
The corrected wrapper reached a positive report, but its child remained alive until the existing deadline killed it.
That report did not establish successful process closure.
The final fixture uses an offscreen render target and fixes its viewport before the Shell document loads.
Linux uses isolated software rendering.
The scoped constructor interception applies only to Main's Electron import and restores module loading immediately afterward.
Final successful closure does not establish the exact cause of the earlier macOS exit delay.
No assertion, rendering tolerance, or deadline was relaxed.

CM5 installed locked Shell dependencies with pnpm 11.22.0 and disabled install scripts in the private candidate.
The fixture reused the existing Electron executable after confirming matching package versions of 43.4.1.
It used the `orangepi` service owner, private configuration, state, workspace, profile, and runtime directories.
The executable was read without changing the installed product release or services.
Fresh static review found no actionable findings in the fixture changes.
Only tests and scenarios changed; no product source changed.

The final command ran from the candidate Shell directory:

```sh
node --unhandled-rejections=strict --test --test-concurrency=1 tests/dashboard-main-bootstrap.test.js
```

These checks retain controlled external inputs and DOM, style, and geometry comparisons.
They do not establish raster parity, independent density, live Bot or provider behavior, or physical input and display acceptance.
Windows did not run this extension.
The complete Shell suite was not repeated for this fixture-only extension.


## Native shared Renderer service acceptance

The shared service and actual Dashboard consumer checks passed on CM5 on 2026-10-11.
The command passed 43 checks without failures or skips in 2062 milliseconds.
All 673 captured inputs remained unchanged.
The private candidate used the same Node, Electron, and service owner as the preceding native Dashboard Main command.
No task-owned acceptance process remained after completion.

The command ran from the candidate Shell directory:

```sh
node --unhandled-rejections=strict --test --test-concurrency=1 tests/shared-service-selection.test.js tests/dashboard-lifecycle-electron.test.js
```

The [shared service checks](../tests/shared-service-selection.test.js) use controlled Renderer VM inputs.
They cover service lookup, current implementation selection, refresh cadence, failure isolation, and independent subscription ownership.
Selection releases default inputs; captured callbacks cannot update a deselected service.
Restoration rejects earlier responses and reads current input state.
Failed cleanup retains its owner for retry.
Current-state notifications that replace or remove their service cannot retain restored input subscriptions.

The [Dashboard consumer](../tests/dashboard-lifecycle-electron.test.js) runs actual preload and one Shell document.
It selects an external Home Briefing service and renders that service's error state.
Actual preload updates cannot change the deselected default service.
Restoring the default rereads current status before Dashboard consumes its unavailable state.
Two additional placement cases check captured callbacks and failed unsubscribe recovery.
Former and current nodes retain their proper owners, peer placement, and document identity.

These checks combine bounded VM service behavior with one actual rendered consumer.
They do not establish every selected service through Electron, real providers, physical input, or Windows behavior.
No product source or test changed for this command.

### Quota shared service follow-up

The [Quota checks](../tests/quota-surface-electron.test.js) now verify shared subscription selection after page remount.
Default, independent, and restored surfaces each read and refresh through an independently supplied service.
Its distinct reading and check label identify the selected consumer.
Actual default provider updates cannot overwrite that reading.
Restoration releases the selected subscription and remounts current default readings.
The comparison placement retains its explicitly supplied default service.
This follows existing remount behavior; it does not add automatic subscription transfer.

A controlled consumer bypass must fail with the selection assertion and a normal error exit.
Timeouts, killed children, and unrelated errors cannot satisfy that negative control.
The affected command passed fifty checks locally in 4639 milliseconds and on CM5 in 19208 milliseconds.
Both runs retained all 676 captured inputs; the local final inventory also matched.
A fresh independent source review found no actionable findings and did not execute graphical checks.
Production sources, services, and capture behavior did not change.
The existing Camera, input status, and Dashboard consumer command also passed all eleven checks on both hosts.
It completed locally in 29495 milliseconds and on CM5 in 84660 milliseconds.
All 676 captured inputs remained unchanged in both runs.
These results cover selected Camera, connection, gamepad, Home Briefing, and Quota consumers after remount.
The Pi briefing follow-up below owns selected legacy briefing evidence.
Windows behavior, live providers, and physical input remain outside these follow-ups.

Historical command from before the Camera Widget retirement:

```sh
node --unhandled-rejections=strict --test --test-concurrency=1 tests/quota-surface-electron.test.js tests/shared-service-selection.test.js tests/fixture-rejection.test.js
node --unhandled-rejections=strict --test --test-concurrency=1 tests/camera-surface-electron.test.js tests/input-status-surface-electron.test.js tests/dashboard-lifecycle-electron.test.js
```

### Pi briefing service follow-up

The [Pi status checks](../tests/pi-status-surface-electron.test.js) now select an independent briefing contribution service before remounting.
Default, independent, and restored surfaces each publish working, settled, and unavailable statements through that service.
Fresh publication counters identify both actual and comparison consumers before their statements are compared.
The deselected default store retains its previous statements.
Disable releases both Tick subscriptions and preserves the selected service's last statements.
Restoration publishes current readings through the default store without changing the deselected service.
This preserves the existing legacy briefing contract; Personal Agent Today remains a separate consumer.

A development control bypasses shared service selection and must fail the default phase's selection assertion.
Positive checks cover all three implementation phases through development and signed loading.
Every negative Pi status check now requires a normal error exit; killed children and watchdog failures cannot establish rejection.
The affected command passed 63 checks locally in 10787 milliseconds and on CM5 in 35617 milliseconds.
Both runs retained all 676 captured inputs; the local final inventory also matched.
A fresh independent source review found no actionable findings and did not execute graphical checks.
Production sources, services, and capture behavior did not change.
Windows remained offline during a fresh Tailscale inspection after these checks started.
These checks do not establish Windows behavior, natural Tick progression, live providers, physical input, or display presentation.

Run the affected command from the candidate Shell directory:

```sh
node --unhandled-rejections=strict --test --test-concurrency=1 tests/pi-status-surface-electron.test.js tests/pi-status-surface-lifecycle.test.js tests/shared-service-selection.test.js tests/fixture-rejection.test.js
```


## Current native diagnostic consumer comparison

The production Main diagnostic consumer comparison passed on CM5 on 2026-10-11.
The focused command passed one scenario without failures or skips in 35095 milliseconds.
All 673 captured inputs remained unchanged.
It used the private candidate, dependencies, executable, and service owner from the native Dashboard Main acceptance.

The first focused wrapper nested its temporary directory too deeply for the Unix socket paths.
Listeners reported `EINVAL`, and the required Main plugin state assertion failed before consumer comparisons.
The corrected wrapper uses a separate private short temporary directory.
No test source, product source, assertion, or deadline changed.
No task-owned acceptance process remained after the successful command.

The command ran from the candidate Shell directory:

```sh
node --unhandled-rejections=strict --test --test-concurrency=1 --test-name-pattern='externally selected diagnostic consumers' tests/app-manager-main-bootstrap.test.js
```

The [scenario](../tests/app-manager-main-bootstrap.test.js) runs default and development selections through actual production Main and preload.
Nine missing-candidate modes must fail at the production fallback guard.
The positive modes retain Main plugin states, diagnosis results, discovery, management commands, notification results, and navigation behavior.
Normal process closure releases diagnostic listeners, handlers, and private management endpoints.
Inputs remain controlled; this result does not establish live external runtime diagnosis.

The [scope status](#scope-and-status) records the complete local gate independently.


## Native process rejection and combined Clock acceptance

The current private CM5 candidate passed twelve built-in view and process rejection checks on 2026-10-11.
All 674 captured inputs remained unchanged during that command.
It completed in 116279 milliseconds without failures or skips.
Programmatic, development, and signed Native selections preserve the public App scenarios.
Each controlled invalid Clock or focus entry must fail with exit code one, no signal, and no parent kill.
Matching error text from a killed child cannot establish deliberate rejection.
The [process checks](../tests/fixture-rejection.test.js) reproduce ordinary exit and actual signal termination.

The subsequent combined Clock and isolation command passed 98 checks without failures or skips in 92733 milliseconds.
All 676 captured inputs remained unchanged.
It used Node 24.16.0, Electron 43.4.1, and the `orangepi` service owner with private configuration, state, endpoints, and profiles.
No task-owned acceptance process remained after completion.

The Clock fixture gives production Main's hidden window an offscreen render target.
Its scoped constructor retains production preferences and restores the module loader immediately after Main loads.
The original deadline of forty seconds still failed during the final restored Pre-order transition.
An independent observation preserved all assertions and completed in 41756 milliseconds.
Only Linux arm64 combined mode now uses sixty-second fixture, sixty-five-second child, and ninety-second parent deadlines.
Other hosts and shorter Clock modes retain their existing deadlines.
The final combined scenario completed in 41954 milliseconds.
The [budget checks](../tests/clock-main-timeouts.test.js) cover the target restriction and shared watchdog configuration.

The final command ran from the candidate Shell directory:

```sh
node --unhandled-rejections=strict --test --test-concurrency=1 tests/clock-main-bootstrap.test.js tests/e2e-isolation.test.js tests/clock-main-timeouts.test.js tests/fixture-rejection.test.js
```

Clock revision activation, calendar boundaries, static tools, Pre-order canvas comparisons, shared Tick ownership, and resource cleanup retain their original assertions.
Only test fixtures, helpers, and scenarios changed.
Fresh independent reviews reported no findings in the process rejection, hidden window scope, or bounded target budget changes.
These native results do not establish physical presentation, live providers, Windows behavior, or the complete local Shell gate.


### Clock Main rejection follow-up

Fresh independent review found two existing Clock Main negative guards that accepted matching text without checking process termination.
Two new regressions failed against those guards and passed after they used the shared rejection predicate.
The regressions execute the actual guard call sites with normal failure and watchdog error objects.
Separate real child checks retain ordinary exit and signal termination coverage.

The updated candidate passed twelve Clock Main and rejection checks on CM5 in 92939 milliseconds.
All 676 captured inputs remained unchanged, and no task-owned acceptance process remained.
Both actual missing-control and missing-Tick paths now require exit code one, no signal, and no parent kill.
Fresh independent review reported no findings after this repair.

```sh
node --unhandled-rejections=strict --test --test-concurrency=1 tests/clock-main-bootstrap.test.js tests/fixture-rejection.test.js
```

The corresponding local follow-up passed all twelve checks in 69557 milliseconds.
All 676 captured inputs and its final inventory remained unchanged.

## Final external runtime and native host gates

The local external component gates completed on 2026-10-11.
Personal Bot passed 602 tests and skipped three Windows checks; its TypeScript check also passed.
Remote Bridge passed all 65 tests.
Futu passed 286 tests and skipped two Windows checks.
The native common host passed four tests, S3 host checks passed seven, and P4 host checks passed seventeen.
These are separate component results, not physical peripheral acceptance or a complete Shell result.
All 272 captured external inputs remained unchanged during each completed command.
The complete CM5 component commands also passed on 2026-10-12 in private candidate state.
Personal Bot passed 602 checks, skipped three Windows checks, and passed its TypeScript check.
Remote Bridge passed 65 checks; Futu passed 286 checks and skipped two Windows checks.
The Bot command retained 1100 inputs unchanged, including 66 captured Console and shared library files.
The Bridge and Futu commands each retained 1034 inputs unchanged.
All captured code matched the worktrees afterward; only the coverage and matrix reports had changed since capture.
The retrieved receipts are in `/Users/FradSer/.codex/tmp/odk-cm5-mhh_5e89/component-bot/`, `component-bridge/`, and `component-futu/`.
The first Bot attempt failed seven workspace checks because the private snapshot had no `.git` directory.
After private workspace initialization, one check still required the adjacent Console package.
The final complete command used captured Console and shared library sources with the candidate's installed Pi dependencies.
These staging repairs changed no production source; no failed assertion was disabled.
Futu used uv 0.11.18, Python 3.11.2, a private package cache, and a short private pytest directory.
The uv Linux arm64 archive matched its published SHA-256 before extraction.
These commands use synthetic inputs and private listeners; they do not establish live providers or physical peripherals.
No product service, release activation, camera capture, or microphone capture occurred.

The initial Bot run failed because its endpoint test assumed an absent `XDG_RUNTIME_DIR`.
The [endpoint check](../../../integrations/personal-bot/tests/task-endpoint.test.mjs) now controls and restores that environment value and checks configured fallback.
Its isolated CM5 command passed all three checks in 171 milliseconds with both uploaded inputs unchanged.
That command ran as `orangepi` with Node `v24.16.0`; it does not establish complete native Bot acceptance.
The initial combined Python command could not collect two identically named modules.
Separate component commands preserve their existing collection conventions.
A long private pytest directory exceeded Unix socket path limits and caused Futu startup failures.
The complete Futu rerun uses a separate short private `--basetemp` directory.
One remaining startup check inherited an available management channel and incorrectly expected immediate process exit.
The [startup selection check](../../../integrations/futu-poller/tests/test_shared_preferences.py) now explicitly disables that channel within its fixture.
Both test repairs reproduced failures before correction; their complete component reruns passed afterward.
Product sources, service configuration, and hardware remained unchanged.

Run each command from its stated directory.

```sh
# integrations/personal-bot/
corepack pnpm@11.22.0 test
corepack pnpm@11.22.0 typecheck
# Repository root; use a new short private directory for FUTU_TEST_ROOT.
node --unhandled-rejections=strict --test integrations/remote-bridge/test/*.test.js
uv run --with pytest pytest -q integrations/futu-poller/tests --basetemp "$FUTU_TEST_ROOT"
uv run --with pytest pytest -q peripherals/common/tests
uv run --with pytest pytest -q peripherals/esp32-s3-remote/tests
uv run --with pytest pytest -q peripherals/esp32-p4-camera/tests
```


## Renderer bridge programmatic replacement

The Renderer control and diagnosis implementations already used the common Host.
Their composition previously exposed only its readiness promise.
Trusted Shell code can now inspect that Host catalog and replace either factory through its existing replacement operation.
The [guide](AI_PLUGIN_GUIDE.md#renderer-bridge-implementation-replacement) owns this interface.

The [scenarios](../tests/features/plugin-host.feature) require subscription ownership, peer preservation, rejected contracts, and shutdown refusal.
Two [new regressions](../tests/renderer-bridge-replacement.test.js) failed before the interface was exposed.
The selected factories own their subscriptions without calling the default factories.
The control comparison exercises inventory; the diagnosis comparison includes current bridge identities and lifecycle states.
Replacement releases the former subscription and makes retained callbacks inert.
Invalid contracts preserve the selected version, and page shutdown releases both subscriptions.
A third regression verifies candidate startup cleanup and restoration of the default diagnosis response.

The affected command passed 115 checks on macOS and CM5 with no failures, cancellations, or skips.
It includes the existing Host replacement, shutdown, cleanup-failure, and concurrency checks.
The existing Electron diagnosis consumer also passed in this command.
Fresh independent source review found no actionable findings and did not run checks.
A shared control scenario compares surface and Appearance enable, disable, activation, and restoration receipts through both bridge implementations.
The independent [control bridge](../tests/fixtures/renderer-bridge-control-replacement.js) owns dispatch and uses the existing public controllers.
It does not import or call the default bridge factory.
The inventory-only alternative failed the shared scenario before its dispatch was completed.
Invalid activation, failed restoration, and pending lifecycle completion after shutdown cannot report success.
The VM comparisons use controlled public controllers.
The [production Main comparison](../tests/clock-main-bootstrap.test.js) also selects this bridge in the actual isolated Electron document.
The real CLI disables and enables Appearance while preserving the saved theme choice.
Signed Clock activation, update, and captured built-in recovery preserve the document, foreground App, peer ports, and Tick ownership.
A missing selected bridge exits normally with the expected version error.
Page shutdown releases the selected request subscription.
All 116 affected checks passed on macOS and CM5 with all 1034 captured inputs unchanged.
The current receipts are `/Users/FradSer/.codex/tmp/odk-bridge-cli-mac-4kxn_0yx/` and `/Users/FradSer/.codex/tmp/odk-cm5-mhh_5e89/`.
These checks use private state and controlled providers; they do not establish Windows or physical input acceptance.
The VM comparisons use controlled Renderer globals.
An additional diagnosis comparison uses the actual Electron document, preload, and Main report consumer.
Default and selected reports match after explicit verification of the selected bridge version.
The same document and Clock node remain connected, and page shutdown releases the selected subscription.
A deliberately missing replacement must exit normally with the expected version error.
Both private affected commands retained all 1034 captured inputs unchanged, and those inputs matched the worktree before this report update.
These comparisons do not establish visible rendering or physical input.
The interrupted CM5 complete command used an earlier captured candidate without this interface change.

Run from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/renderer-bridge-replacement.test.js tests/renderer-control-bridge.test.js tests/renderer-diagnostics.test.js tests/plugin-host.test.js tests/plugin-host-replacement.test.js tests/renderer-plugin-host.test.js
```


The additional production Main command ran from `runtime/shell/`:

```sh
node --test --test-concurrency=1 tests/clock-main-bootstrap.test.js tests/clock-main-timeouts.test.js tests/e2e-isolation.test.js tests/renderer-bridge-replacement.test.js tests/renderer-control-bridge.test.js
```

## CM5 complete command staging diagnosis

The private CM5 candidate captured 1014 Shell, integration, peripheral, and product inputs.
Its configuration inventory check reported a missing consumer script.
The [documented STT consumer](../../../integrations/local-stt-bridge/scripts/provision-stt-bridge.sh) exists in the worktree but was absent from that capture.
A read-only CM5 rerun of `tests/config-inventory.test.js` reproduced exactly this missing path: three checks passed and one failed.
The next complete candidate must include this documented input.
A separate corrected candidate captured 1016 inputs, including the consumer script and current Renderer bridge changes.
Its CM5 configuration inventory command passed all four checks in 180 milliseconds.
All captured inputs remained unchanged and matched the worktree after that command.
This focused result does not clear the earlier complete gate or verify the corrected candidate through Electron.
The failed candidate was not changed during execution.
The complete command was interrupted after known failures and a staging omission.
It does not provide a complete gate result.
Its complete gate has not passed.
A focused rerun reproduced all three Electron failures against unchanged inputs.
The installed desktop fixture reported `EINVAL` for its Renderer Control Unix socket at a long private path.
Appearance phase tracing reached font readiness, then stopped while waiting for the first animation frame.
A private diagnostic copy with offscreen rendering completed the signed comparison in six seconds.
This experiment does not clear the standard tests or the complete gate.

The corrected candidate passed 122 affected checks on CM5 with a short private temporary path.
This command includes the new Renderer bridges, Host lifecycle checks, and all Main manager bootstrap scenarios.
The previously failing installed desktop scenario passed without a product or test source change.
All 1016 captured remote inputs remained unchanged; the local coverage report changed after capture.
The two Appearance restoration checks require a separate standard rerun after the fixture correction.

The local complete Shell command passed 2257 checks with two platform skips and no failures.
Its 677 captured inputs and final inventory remained unchanged.
The Appearance fixture received `offscreen: true` after this command completed.
The subsequent local Appearance command passed all eighteen checks with its 677 captured inputs and final inventory unchanged.
The complete CM5 command in [Scope and status](#scope-and-status) subsequently passed after that fixture change.
Both signed-startup and empty-startup diagnostic copies completed on CM5 in approximately six seconds with offscreen rendering.
The fixture retains its existing deadline, font readiness, geometry checks, and theme assertions.


## Home Widget and App integration candidate

Home contains six Widgets, including the AI usage Widget.
`odk.tile.quota` opens `odk.app.quota` through the shared App manager.
The shipped layout has no Usage page.
`odk.page.quota` remains registered for existing page replacements.
Page-surface acceptance places that page explicitly.

The Quota Widget reads the shared service on each Tick.
Only healthy accounts with finite percentages can supply its meter.
Unknown readings hide the meter and retain no accessible percentage.
The low-state threshold uses the raw reading before display rounding.
The App owns quota refresh and account details.

The Pomodoro App retains one session across view closure.
Controls and public actions share that session.
Repeated Start retains the original completion time.
The resting Widget identifies the App timer without claiming a session state.
It acquires no provider, Tick, connection, or input subscriptions.
The independent App fixture uses its own session through the public context.

Pre-order has a dedicated three-by-three page.
Reading retains its three-by-three WeRead Widget.
Desk retains Hydra.

Focused Node checks passed 156 tests on 2026-10-17.
The style build generated 45 utilities.
Private CM5 runs passed the complete geometry, E2E, and smoke commands with Electron 43.5.0.
The subsequent Quota fill repair passed all six affected Electron checks on CM5.
These checks cover the default App, production Main, development page, signed page, and authenticated page recovery.
They measure actual meter widths under the existing Content Security Policy.
The combined Linux full suite remains pending after the fixture and meter repairs.
The density fixture measures the unavailable Quota placeholder.
It does not establish the density of a live account reading.

No device deployment is included in this change.
Physical input, production device pixels, and screen-reader output remain unverified.
Independent replacements of `odk.app.quota` and `odk.tile.quota` remain unproven.
