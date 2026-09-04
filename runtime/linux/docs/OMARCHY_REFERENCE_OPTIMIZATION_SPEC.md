# Open DeskOS CM5 Optimization Specification

## Problem Statement

The current Open DeskOS CM5 runtime demonstrates a trustworthy Electron kiosk shell, but its delivery, extension, and acceptance paths are still a feasibility-slice workflow. Deployment overwrites a live tree with rsync and reruns an installer. There is no runtime-owned release identity, no atomic activation or application-level rollback, no recorded migration state, and no single acceptance report that verifies the release lifecycle alongside the kiosk, service, and hardware evidence.

The renderer already has a declarative built-in plugin composition model, but contract checking is limited to runtime registration and basic layout lookup. A future change can create mismatched plugin metadata, placement, built-in view continuation, or lifecycle cleanup without a clear preflight failure. The current shell also exposes dense status material in the peek and a minimal status bar; it has not yet been deliberately tuned around the CM5 instrument hierarchy: glanceable state, one evident next action, then a focused view.

Omarchy supplies useful patterns: a single host with a configuration and plugin registry, semantic theme roles, idempotent migrations, controlled update transactions, and one supported health/update path. Open DeskOS must adapt those patterns to a fixed-purpose, sandboxed CM5 appliance rather than adopting a general-purpose desktop distribution.

## Solution

Evolve `runtime/linux/` into a release-managed CM5 kiosk runtime with a controlled extension contract and a more legible desk-instrument shell.

The runtime will deploy immutable, versioned releases under the Open DeskOS-owned installation root. A device-owned updater will stage, preflight, activate, restart, and verify a candidate release as one transaction. It will retain the preceding known-good release and roll back to it automatically if required post-activation verification fails. Runtime-owned, idempotent migrations will advance only Open DeskOS configuration and service state, never unrelated operating-system or user-desktop state.

The existing built-in renderer registry remains static and repository-controlled. It gains a manifest-like metadata contract and preflight validation, but it does not download, execute, or hot-reload third-party plugins. The existing `DESIGN.md` token system remains the only visual authority; a future theme format may carry token values only, never CSS, JavaScript, fonts, URLs, or hooks.

The shell will be refined as an instrument: the status bar continues to contain only primary, glanceable system cues; the peek summarizes factual readiness and has one explicit transition into a focused status view; page-level surfaces preserve Today-first truth, direct touch/keyboard navigation, and bounded Remote Control paging. No desktop window-management concepts, fabricated personal data, or experimental peripheral gating are introduced.

One device acceptance command is the highest integration seam. It emits a structured JSON report for the active release, activation/rollback state, runtime migration state, services, Electron smoke, display, touch, and input evidence. Host tests exercise the same release and validation contracts without claiming physical CM5 evidence.

## User Stories

1. As a CM5 desk owner, I want a runtime update to stage before activation, so that a partial transfer never replaces my usable kiosk.
2. As a CM5 desk owner, I want only one Open DeskOS update transaction to run at a time, so that concurrent updates cannot corrupt runtime state.
3. As a CM5 desk owner, I want an update to validate its own dependencies, generated stylesheet, and smoke behavior before it becomes active, so that obvious bad releases never launch on boot.
4. As a CM5 desk owner, I want an update failure to leave the current known-good release active, so that the desk surface remains available.
5. As a CM5 desk owner, I want an activation failure to restore the preceding release automatically, so that recovery does not require shell access to a broken kiosk.
6. As a CM5 desk owner, I want a recorded active release and rollback candidate, so that a device acceptance report explains exactly what is running.
7. As a CM5 desk owner, I want the kiosk launcher to resolve the active release rather than a mutable source directory, so that autostart and manual launches run the same release.
8. As a CM5 desk owner, I want Open DeskOS service units to restart only after a successful activation, so that Remote Bridge and the optional Face Agent do not become update dependencies.
9. As a CM5 desk owner, I want only Open DeskOS-owned state migrated during an update, so that my desktop and operating-system configuration are not changed unexpectedly.
10. As a CM5 desk owner, I want each migration to be safe when retried, so that interrupted updates and recovery attempts do not leave duplicate or partial configuration.
11. As an operator, I want a fresh installation to establish the current migration baseline, so that obsolete migrations are not replayed on a new CM5.
12. As an operator, I want migration completion and failures recorded per kiosk user, so that acceptance evidence identifies the user-scoped runtime state.
13. As an Open DeskOS developer, I want a release preflight to reject an incomplete or malformed package before activation, so that deployment faults are detected on the host and device.
14. As an Open DeskOS developer, I want generated UnoCSS to be refreshed and verified before a release activates, so that the tracked generated asset matches the source.
15. As an Open DeskOS developer, I want a static built-in plugin contract, so that every visible capability has validated identity, kind, lifecycle, placement, and optional built-in-view continuation.
16. As an Open DeskOS developer, I want layout declarations to be checked against registered plugin metadata, so that unknown, mistyped, or incompatible placements fail before renderer composition.
17. As an Open DeskOS developer, I want a tile that declares `open-app` to reference one valid built-in app definition, so that a touch target never promises an unavailable continuation.
18. As an Open DeskOS developer, I want lifecycle cleanup verified for subscriptions and other registered cleanup functions, so that moving between pages and views does not leak background work.
19. As an Open DeskOS developer, I want plugins to remain repository-controlled local scripts under the renderer CSP, so that no theme or plugin can expand renderer privileges.
20. As a desk user, I want the top bar to show only immediate orientation signals, so that I can read connection, location, and time at a glance.
21. As a desk user, I want the peek to summarize actual provider, network, Remote Link, and foreground view state, so that I can understand readiness without seeing invented activity.
22. As a desk user, I want the peek to open a focused status surface with factual detail and a clear recovery action where one is available, so that the collapsed summary is not the only place status can be understood.
23. As a desk user, I want Today to remain the first surface and to present only local or provider-backed facts, so that the desk display remains trustworthy when every optional integration is absent.
24. As a desk user, I want Back and Escape to restore the context from which I entered a focused surface, so that status inspection never traps me.
25. As a desk user, I want touch and keyboard navigation to remain available while updates are not running and when Remote Link or optional vision is unavailable, so that required hardware acceptance remains independent.
26. As a Remote Control user, I want page navigation to remain bounded and its state feedback to remain authoritative after a runtime update, so that the remote never guesses the current page.
27. As a device acceptance operator, I want one JSON report that combines runtime-release, migration, kiosk, service, display, touch, and smoke evidence, so that host-green and hardware-verified evidence are not confused.
28. As a device acceptance operator, I want a report to explicitly identify unavailable checks rather than infer success, so that unverified CM5 hardware is never represented as accepted.
29. As an Open DeskOS maintainer, I want theme evolution restricted to validated semantic tokens if it is introduced later, so that the visual system can vary without allowing executable or remote content.
30. As an Open DeskOS maintainer, I want to retain the direct CM5-first design and independent P4/S3 acceptance gates, so that optimization does not reintroduce a Mac or preserved P4+C6 dependency.

## Scenarios

```gherkin
Feature: Open DeskOS CM5 controlled runtime lifecycle

  Scenario: A verified staged release activates atomically
    Given a current Open DeskOS release is active on the CM5
    And a newer complete release has been staged outside the active release path
    When the device updater preflights the staged release successfully
    Then it records the current release as the rollback candidate
    And it atomically selects the staged release as active
    And it restarts only Open DeskOS-owned user services after activation
    And the kiosk launcher resolves the newly active release

  Scenario: A failed preflight preserves the active release
    Given a current Open DeskOS release is active on the CM5
    And a staged release has a failed dependency, stylesheet, contract, or smoke preflight
    When the device updater attempts activation
    Then the staged release is not selected as active
    And the current release remains the active release
    And the updater records a factual failure reason

  Scenario: A failed post-activation check rolls back
    Given a current Open DeskOS release and a valid rollback candidate exist
    And a staged release passes preflight
    When the staged release becomes active but fails its required post-activation verification
    Then the updater atomically restores the rollback candidate
    And it restarts the restored release's Open DeskOS-owned services
    And the acceptance report identifies the failed candidate and restored active release

  Scenario: Only one updater transaction changes release state
    Given an Open DeskOS update transaction already holds the device update lock
    When a second update request starts
    Then the second request exits without changing active or rollback release state
    And it reports that another transaction owns the lock

  Scenario: An interrupted migration may be retried safely
    Given an Open DeskOS migration has not recorded successful completion
    When the migration runs again
    Then it makes the required Open DeskOS-owned state change exactly once
    And it records completion only after the change is valid
    And it does not alter unrelated user or operating-system configuration

  Scenario: A fresh kiosk user starts at the current migration baseline
    Given a new CM5 kiosk user receives a current runtime release
    When runtime provisioning initializes that user
    Then existing historical migrations are recorded as complete for that user
    And only migrations introduced after that release may run later

Feature: Built-in plugin contract

  Scenario: The release preflight validates declarative built-in composition
    Given a candidate runtime release contains the renderer registry and desktop layout
    When release preflight validates the plugin contract
    Then every registered plugin has a unique Open DeskOS-owned identity and supported kind
    And every plugin provides the complete lifecycle contract
    And every layout page and tile references a compatible registered plugin
    And every open-app tile references one valid built-in app

  Scenario: A malformed built-in plugin cannot activate
    Given a candidate runtime release contains a duplicate plugin id, unsupported kind, missing lifecycle, or incompatible layout declaration
    When release preflight validates the plugin contract
    Then preflight fails before the candidate can become active
    And the active release remains unchanged

  Scenario: Built-in plugins remain a local trusted extension boundary
    Given a runtime release is active
    When the renderer loads its plugins
    Then it loads only packaged local scripts permitted by the existing CSP
    And it does not download, execute, or hot-reload third-party plugin code
    And it does not expose Node, filesystem, or process APIs to the renderer

Feature: Desk instrument experience

  Scenario: The shell keeps status glanceable and truthful
    Given the runtime starts without configured OpenCode Go, Remote Link, or experimental vision
    When the first page renders
    Then the top bar presents only network reachability, page orientation, and local time
    And Today presents only local and provider-backed facts
    And the Usage and Remote Control surfaces identify unavailable provider and Remote Link state without fabricated personal activity

  Scenario: Renderer status presentation preserves independent peripheral gates
    Given Remote Link or experimental Face Agent is unavailable
    When the user navigates with direct touch or keyboard
    Then Today, Home, Usage, focused views, and bounded paging remain usable
    And no unavailable peripheral state blocks or obscures core shell data

Feature: Unified acceptance evidence

  Scenario: Device acceptance reports runtime and hardware facts together
    Given an installed Open DeskOS CM5 runtime
    When the acceptance command runs on the device
    Then it emits one JSON report with active release, rollback candidate, updater state, migration state, kiosk service, Remote Bridge, optional Face Agent, Electron smoke, display, touch, and input checks
    And each unavailable check is reported as unavailable or failed rather than successful
    And the command exits unsuccessfully when a required acceptance check fails

  Scenario: Host validation does not claim hardware acceptance
    Given a candidate release is validated on a development host
    When host tests complete
    Then they verify release preflight, migration, plugin contract, smoke, and end-to-end renderer behavior
    But they do not report CM5 GPU, HDMI, evdev touch, autostart, Remote Control, or camera hardware as accepted
```

## Implementation Decisions

1. **Adopt release directories owned by Open DeskOS.** The CM5 installation root will distinguish an immutable release store from mutable device state. The launcher resolves a single active-release pointer rather than treating the synced source directory as the executable runtime. A release has an explicit version identifier and metadata sufficient to identify source revision, build/preflight outcome, creation time, and required runtime schema versions.

2. **Use atomic pointer changes, not in-place overwrites.** A candidate is fully staged under a new release directory. The updater changes the active pointer only after preflight success, using an atomic filesystem operation on the same filesystem. It retains the immediately preceding successful active release as the rollback candidate. The first implementation guarantees application-level rollback; it does not claim operating-system, package-manager, kernel, or filesystem snapshot rollback.

3. **Define one updater transaction.** A single CM5-only command owns staging validation, release selection, service restart, post-activation check, rollback, and structured logging. It uses an exclusive lock under Open DeskOS-owned device state. Lock failure is a normal, factual refusal and never changes release pointers.

4. **Make preflight self-contained and fail-closed.** Candidate preflight verifies release structure, pinned dependency install, generated stylesheet generation, static plugin/layout validation, Node tests, renderer smoke, and any release metadata integrity check. It runs before activation. Preflight has no access to user credentials and does not require Remote Link, P4 camera, Face Agent, or a network provider to pass.

5. **Keep post-activation verification narrow and truthful.** After pointer activation, the updater starts the kiosk and Open DeskOS user services then verifies that the active release resolves, Electron's smoke seam succeeds, and required owned services reach their expected non-fabricated state. A missing optional bridge or experimental service is reported but does not cause base release rollback. A failed base kiosk check does.

6. **Scope service ownership precisely.** Kiosk launching, Remote Bridge, and the opt-in Face Agent remain separate user services/processes. The updater may reload/restart Open DeskOS-owned units only. It must not manage generic desktop services, the display manager, system package updates, Openbox, unrelated user services, or host system configuration beyond explicitly installed Open DeskOS prerequisites.

7. **Introduce versioned, idempotent runtime migrations.** Migrations are ordered by immutable version identifiers and operate solely on Open DeskOS-owned mutable state: runtime configuration schemas, Open DeskOS user services, release pointers, and explicitly opt-in experiment configuration. Completion markers are stored per kiosk user under Open DeskOS state. A fresh provisioner records the current migration baseline rather than replaying historical transformations.

8. **Separate base from experimental migration paths.** Base migrations cannot install, enable, require, or infer acceptance of Face Agent, P4 camera, C6 Gateway, or Remote Control. Experiment migrations require the existing explicit opt-in state and preserve direct touch and keyboard as base control paths.

9. **Preserve the repository-controlled plugin model.** The renderer has built-in plugins packaged inside each release. It does not gain discovery from arbitrary user directories, repository URLs, Git, network downloads, dynamic import endpoints, or hot reload. The only active extension boundary remains a local, versioned, audited release.

10. **Add static plugin metadata without duplicating visual authority.** Each built-in plugin declares a schema version, unique `odk.*` identity, supported kind, capability/continuation metadata where applicable, and lifecycle implementation. The registry normalizes harmless lifecycle defaults as it does today, while preflight validates the explicit contract. `DESKTOP_LAYOUT` remains the single placement authority. The app catalog remains renderer-local support for the existing built-in-view seam, not an installable app platform.

11. **Validate cross-references at the composer boundary.** Validation must reject duplicate plugin identities, unsupported kinds, invalid status slots, a page/plugin kind mismatch, unknown tile/page IDs, invalid grid placement, duplicate layout placement, `open-app` without a valid app ID, an app ID with no matching built-in app, and an app continuation attached to a display-only tile. Validation should remain framework-free and run in Node as well as in the renderer seam.

12. **Retain the existing scoped cleanup ownership.** Plugin subscriptions continue to enter the scoped context and are released on deactivate/retire. New plugin APIs must either return a cleanup function accepted by `trackCleanup` or be lifecycle-owned by explicit stop/unmount behavior. The contract does not force speculative lifecycle complexity for static content.

13. **Keep semantic tokens as the only theming authority.** `DESIGN.md` and checked `--odk-*` CSS variables continue to define the visual language. If theme switching is later accepted, its package is a validated data document containing the full known token set and no executable assets. Applying it is atomic and renderer-local through a narrow IPC path. This is future work, not a prerequisite for release lifecycle, plugins, or UX refinement.

14. **Refine the shell through the existing shell and plugin seam.** The top bar stays limited to network reachability, page location, and clock. The peek remains the collapsed multi-source summary. Selecting it enters a dedicated built-in status view, rather than expanding an always-visible dashboard, opening a desktop panel, or introducing a command palette. The status view uses current service labels and factual source provenance; it may offer only already-supported recovery actions such as refresh/retry.

15. **Preserve navigation and input contracts.** Existing touch swipe, page-dot, keyboard Arrow/Home/End, bounded Remote navigation, Remote Bridge authoritative page state, dialog focus trap, Back/Escape restoration, and reduced-motion behavior remain contracts. Update activity must not make a released kiosk interactive until it passes activation; it must not insert a misleading progress dashboard into the normal desk surface.

16. **Extend the acceptance command as the single device-level seam.** The current CM5 acceptance script becomes the authoritative device report. It adds release identity/current pointer, previous known-good release, updater lock/last transaction status, migration markers, user service status, and kiosk launch resolution to its existing architecture, session, display, GPU, touch, Electron, smoke, library, and autostart facts. It keeps emitting one JSON object and returns nonzero for unmet required acceptance checks.

17. **Keep evidence classifications explicit.** Acceptance fields distinguish required base checks, optional architecture peripheral checks, opt-in experiment checks, informational checks, unavailable checks, and failures. A host run and a no-display run may produce useful reports but cannot satisfy CM5 hardware acceptance fields.

18. **Retain CM5-first boundaries.** The Linux Electron runtime remains active product authority. No Mac companion, P4+C6 research contract, or desktop-shell feature becomes a condition of runtime release or base kiosk usability. The S3 Remote and P4 camera retain independent acceptance gates.

## Testing Decisions

1. **Highest test seam: one acceptance report.** The primary integration behavior is validated through the extended CM5 acceptance command, which produces one JSON document. Tests assert report semantics and exit status, not incidental implementation details. The report is the only source that can mark physical CM5 checks as passed.

2. **Host release lifecycle tests.** Node tests simulate staging, lock contention, preflight success/failure, activation, service-restart orchestration, post-activation verification, rollback, immutable release metadata, and pointer state. They use temporary directories and fake service runners; they do not call real systemd, apt, or mutate `/opt`.

3. **Migration tests.** Node or shell contract tests exercise clean provision, repeated execution, interrupted/retry execution, ordering, per-user marker isolation, base-versus-experimental separation, and failure-before-marker behavior. Test state is temporary and explicit.

4. **Plugin and composition tests.** Extend the existing registry contract tests and composer validation tests. Test public outcomes: duplicate identity rejection, lifecycle completeness, cleanup, kind/slot compatibility, valid layout references, invalid `open-app` continuations, and valid app mapping. Do not test private maps or incidental invocation order unless it is part of a lifecycle guarantee.

5. **Renderer end-to-end tests.** Extend the existing Electron E2E driver to check the retained status-bar hierarchy, peek summary, focused status view, factual unavailable states, recovery action availability, dialog inertness/focus, Back/Escape restoration, touch/keyboard pager behavior, and renderer sandbox/CSP properties. Continue the current geometry sweep at the configured desktop and smaller development window sizes.

6. **Visual and accessibility checks.** Continue token parity and generated stylesheet checks, all-local font and asset checks, Tabler icon assertions, English renderer-copy rules, focus-visible rules, tap-target hit areas, reduced motion behavior, and no fabricated personal-data assertions. Use screenshots during implementation review on supported host/device display sizes; device screenshots are supporting visual evidence, not a substitute for acceptance report facts.

7. **Installer and launcher tests.** Add script-level tests that assert the kiosk launcher resolves the active release pointer, records launch identity, does not launch a partially staged release, and preserves the previous release on update failure. Preserve current root-versus-kiosk-user ownership and PNPM resolution coverage.

8. **Device acceptance tests.** Run the extended command on a CM5 after deployment, attach its JSON output to bring-up evidence, and verify base hardware facts on actual HDMI, GPU, touch, graphical autostart, and kiosk session. Exercise Remote Control and P4 camera checks only under their independent hardware acceptance sequences.

9. **Regression baseline.** Every behavior introduced in this effort is first represented by a Given/When/Then scenario in the existing Linux shell feature suite, then implemented through a failing test, then verified through the relevant Node/smoke/E2E/CM5 acceptance command. Existing `pnpm test`, `pnpm smoke`, and `pnpm e2e` remain required host gates.

## Out of Scope

- Becoming a general-purpose Linux distribution, replacing the desktop environment, or adopting Hyprland, Quickshell, tiling window management, workspace controls, touchpad controls, or desktop command palettes.
- Intercepting general system updates, replacing `apt`, or claiming Btrfs/Snapper, kernel, package, or whole-root-filesystem rollback.
- Downloading, installing, executing, or hot-reloading third-party plugins, themes, JavaScript, CSS, fonts, templates, shell hooks, or Git repositories.
- Creating an installable application platform, arbitrary app marketplace, or changing the current built-in-view seam into a broader App Manager product claim.
- Introducing fabricated calendar, task, health, activity, identity, emotion, or provider data to improve perceived completeness.
- Making Remote Link, C6 Gateway, P4 camera, Face Agent, owner recognition, Mac companion, or preserved P4+C6 research required for update, installation, boot, or direct shell input.
- Automatic theme switching. A non-executable semantic-token theme format is only a future design constraint.
- Promoting the CM5 feasibility slice to a supported product line before real-device acceptance evidence exists.

## Further Notes

- Omarchy is a reference for transaction boundaries, user-state migrations, semantic token separation, and manifest validation. It is not the target interaction model or deployment topology. Open DeskOS remains a 1920×1280 CM5 touch kiosk and desk instrument.
- The release lifecycle should be delivered before UI refinement because a visually improved shell is not a device-grade improvement if deployment can overwrite its only working copy.
- Suggested delivery order:
  1. Release root, metadata, active/rollback pointer, updater lock, preflight, atomic activation, and rollback.
  2. Idempotent migration runner plus fresh-user baseline provisioning.
  3. Static built-in plugin metadata and composer preflight validation.
  4. Extended unified CM5 acceptance report and real-device validation.
  5. Status hierarchy and focused peek status view refinement.
  6. Optional future token-only theme proposal after the base release and hardware gates are proven.
- The current `runtime/linux/PRODUCT.md` contains stale statements about a Mac companion and a prior app-state model that conflict with root `PRODUCT.md`, `runtime/linux/CONTEXT.md`, and the current README. During implementation, update it as part of the release/acceptance documentation work, not as a silent design side effect.
