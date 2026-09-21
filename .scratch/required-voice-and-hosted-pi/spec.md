# Voice Agent and Hosted Pi control are required OS components

**Status:** ready-for-agent
**Tracker:** local markdown (`.scratch/<feature>/spec.md`), tickets land in `issues/NN-*.md`

## Problem Statement

The desk can look complete while two capabilities the owner considers part of the OS were never
installed at all.

The runtime's own vocabulary already says the Voice Agent is a system component: `CONTEXT.md` states
it "is a system component of the desk runtime, not an optional plugin, so a desk without it is not a
complete desk rather than a lesser one", and explicitly avoids "optional add-on, experimental
service, voice feature toggle". Hosted Pi control, which is what a Console on another machine drives
and what a Spoken Turn can start, is treated the same way in practice.

The implementation does not agree with that:

- The CM5 installer treats both as optional. A failure to install or start the voice service prints
  `Voice Agent unavailable; base shell remains active`, and the hosted Pi task service prints its own
  warning. Installation continues and reports success.
- Release composition validation only checks the renderer plugin contract. A release that cannot
  serve voice or host a Pi session activates normally.
- `PRODUCT.md` names two required architecture *peripherals* and the Hosted Pi/Console route, but
  never names the Voice Agent as a component, so product authority and runtime vocabulary disagree.
- Nothing on the desk distinguishes "this capability is missing" from "this capability needs
  configuration". A missing STT credential, a microphone that is not plugged in, or a Pi target that
  was never configured can all present as a quiet, healthy desk.

The owner's expectation, stated directly: voice, including control of Pi sessions from another
machine, is part of the OS. The main Shell plus two configurable main features (voice, Hosted Pi
control) is the product. Configuration stays device-local; the Shell presents state and entry, and
never pretends a capability works when it does not.

## Solution

Bring the OS into line with its own vocabulary.

The CM5 runtime is the Display Shell plus two required components: the **Voice Agent** and **Hosted
Pi control** (a Pi session hosted by the runtime and drivable from a Console, or started by a Spoken
Turn). Required means:

- A release must carry both components. A candidate missing either one cannot activate.
- Installation must fail loudly when a required component cannot be installed, naming the component
  and the device-local configuration file involved, instead of warning and continuing.
- The Shell presents both as first-class features with truthful state: ready, needs configuration, or
  unavailable — with the device-local file to create or fix named in the message.
- Neither device configuration nor hardware absence blocks the base Shell, and neither is reported as
  working. Direct touch and keyboard authority is unchanged.

## User Stories

1. As a desk owner, I want the Voice Agent to be part of the OS I install, so that a desk which
   reports a successful installation is a complete desk rather than a lesser one.
2. As a desk owner, I want Hosted Pi control to be part of the OS I install, so that "drive a Pi
   session from my Mac" is a capability the desk has, not an integration someone remembered to add.
3. As a desk owner, I want installation to fail loudly when a required component cannot be installed,
   so that I never get a success report for a desk that cannot serve voice or host a session.
4. As a desk owner, I want the installation failure to name the component and the device-local file
   involved, so that I know what to fix without reading the installer.
5. As a desk owner, I want a release that does not carry the Voice Agent to be rejected before
   activation, so that a broken or partial release cannot replace one that works.
6. As a desk owner, I want the same rejection for a release that does not carry Hosted Pi control,
   so that both required components are gated by the same rule.
7. As a desk owner, I want the Shell to show the Voice Agent's real state — ready, needs
   configuration, or unavailable — so that I can tell a missing capability from a missing credential.
8. As a desk owner, I want the needs-configuration message to name the device-local file and the
   missing setting, so that the desk tells me what to do next.
9. As a desk owner, I want the Shell to show the same truth for Hosted Pi control — configured or
   not, and whether a Console is currently driving a session — so that the two required features are
   reported the same way.
10. As a desk owner, I want the microphone control to be operable only when the Voice Agent can
    actually capture a Spoken Turn, so that pressing it never lies about what will happen.
11. As a desk owner, I want to start a Hosted Pi session by voice when that feature is configured and
    the target is reachable, so that speaking and remote control are one capability rather than two.
12. As a desk owner, I want an unconfigured or unavailable required feature to leave the base Shell
    fully usable through direct touch and keyboard, so that configuration work never costs me the desk.
13. As a desk owner, I want a broken voice feature to leave Hosted Pi hosting working, and vice
    versa, so that one required component's fault does not take the other down.
14. As a Console operator, I want a desk whose Voice Agent is unavailable to still host and keep my
    session across a disconnect, so that the two capabilities are independent in operation while both
    are required in the product.
15. As a desk owner, I want the desk to keep naming which Console currently drives a Hosted Pi for as
    long as that lasts, so that remote control stays attributable and local input keeps its authority.
16. As a desk owner, I want release updates to update the Voice Agent along with everything else, so
    that a fix ships in one artifact instead of being pinned to a versioned side directory.
17. As a desk owner, I want an update that cannot install a required component to leave the previous
    release active, so that a failed update leaves me with a working desk.
18. As a desk owner, I want configuration to remain device-local files with restrictive permissions,
    so that credentials never travel through the Shell or through a release.
19. As a maintainer, I want `PRODUCT.md` to name the Shell, the Voice Agent, and Hosted Pi control as
    required components, so that product authority, runtime vocabulary, and the release gates agree.
20. As a maintainer, I want one release gate that proves both required components are inside the
    artifact, so that a partial build cannot activate.
21. As a maintainer, I want the installer's required-component failures to be installation failures,
    so that automation cannot report a half-installed desk as success.
22. As a maintainer, I want the vocabulary in `CONTEXT.md` to carry the required-ness of both
    components, so that future work inherits the classification instead of re-deciding it.
23. As a maintainer, I want the existing status contracts to carry the required features' state, so
    that this change adds no new transport or surface to maintain.

## Scenarios

Stored with the suites that already own these contracts:
`runtime/linux/tests/features/runtime-release.feature`, `voice-agent.feature`,
`voice-status-protocol.feature`, `pi-sessions-remote.feature`.

```gherkin
Feature: Required voice and Hosted Pi control components

  Scenario: A candidate carrying both required components activates
    Given a release candidate containing the voice integration, its unit template, and its installed production dependencies
    And the Hosted Pi control unit template
    When the candidate is validated for composition
    Then validation accepts the candidate

  Scenario: A candidate missing the voice integration is rejected
    Given a release candidate without the voice integration source
    When the candidate is validated for composition
    Then validation rejects it naming voice as the missing required component
    And the active release is unchanged

  Scenario: A candidate missing Hosted Pi control is rejected
    Given a release candidate without the Hosted Pi control unit template
    When the candidate is validated for composition
    Then validation rejects it naming Hosted Pi control as the missing required component

  Scenario: An uninstallable required component fails the installation
    Given a release candidate and a host where the voice service cannot be installed
    When the installer installs the release
    Then the installation reports failure naming the voice component
    And it does not report the release as successfully installed

  Scenario: A failed required component leaves the previous release active
    Given an active release and a candidate whose required component cannot be installed
    When the update fails
    Then the previous release remains active
    And the desk keeps serving voice and hosting sessions from it

  Scenario: Unconfigured voice is visible instead of looking healthy
    Given an activated release whose voice configuration is missing a credential
    When the Shell reads the voice status
    Then the state is needs configuration
    And the message names the device-local file and the missing setting
    And no ready or idle state is reported

  Scenario: An absent microphone is visible instead of looking healthy
    Given an activated release with no capture device available
    When the Shell reads the voice status
    Then the state is unavailable naming capture as the cause
    And the microphone control is inert

  Scenario: Unconfigured Hosted Pi control is visible
    Given an activated release without a Hosted Pi task configuration
    When the Shell reads the Hosted Pi control state
    Then it reports needs configuration naming the device-local file
    And the Shell does not claim a target is reachable

  Scenario: The base Shell works while required features are unconfigured
    Given voice and Hosted Pi control are both unconfigured
    When the desk starts
    Then direct touch and keyboard interaction remains fully usable
    And both features present their needs-configuration state

  Scenario: A voice fault does not stop Hosted Pi hosting
    Given the voice service is unavailable
    When a Console lists and launches a Hosted Pi session
    Then the session is hosted normally
    And the desk still reports voice as unavailable

  Scenario: Control attribution survives a required-component fault
    Given a Console is driving a Hosted Pi
    When the voice component restarts or fails
    Then the desk still names the driving Console for as long as that control lasts
```

## Implementation Decisions

- **Product authority.** `PRODUCT.md` names the Display Shell, the Voice Agent, and Hosted Pi control
  as required components of the CM5 runtime, in the active architecture, and its principles gain the
  rule this feature establishes: required components are gated at release and installation, while
  missing device configuration or hardware is reported truthfully and never blocks the base Shell.
- **Runtime vocabulary.** `CONTEXT.md` already states the Voice Agent's required-ness and is the
  authority for it; the Hosted Pi entries gain the same clause so both components are classified once.
  The capability the owner calls "remote" is expressed as a Hosted Pi driven from a Console — the
  glossary reserves "remote" for `Remote Control` and `Remote Bridge`, which are the S3 peripheral.
- **Release gate (single gate for both components).** Release composition validation gains a required
  components check: the voice integration source entry, its systemd unit template, and its installed
  production dependencies resolving inside the release, plus the Hosted Pi control unit template. A
  missing component rejects the candidate with a reason naming that component, at the same point that
  already rejects a renderer contract violation, so preflight reports it before activation.
- **Installer.** The required-component install steps stop being tolerated. Their failure becomes an
  installation failure with a message naming the component and the device-local file involved. The
  ordering is unchanged: the Shell unit is written first, required components follow, and the runtime
  update already leaves the previous release active when activation does not verify.
- **Enablement versus configuration.** A required component is installed and its unit staged in every
  release. The service is started when the host has its device-local configuration: an unconfigured
  service that restarts on failure would produce a crash loop, which reports less than a visible
  needs-configuration state does. The Shell reports that state instead of the installer hiding the
  component.
- **Shell presentation (no new surfaces, no new transport).** The existing voice status entry and the
  existing Pi sessions view carry the required-feature framing: each reports ready, needs
  configuration, or unavailable, and each names the device-local file to create or fix. No credential,
  endpoint, or target is entered in the Shell.
- **Independence.** Voice and Hosted Pi control keep separate services and separate lifecycles: a
  voice fault must not stop hosting, and a hosting fault must not stop voice. Both being required does
  not make them mutually dependent.
- **No secret in the release or the Shell.** Configuration stays in device-local files owned by the
  kiosk user with `0600` permissions, as today.

## Testing Decisions

- **Seams.** Two existing public seams, no new ones. The highest is the release and installation gate:
  release composition validation in the runtime release library, plus the installer scripts. The
  second is the Shell's existing status contract for voice and for Hosted Pi sessions, which already
  publishes state, message, and availability. Prefer the first seam for every behavior this spec
  classifies; the Shell work is verified through the contract it already has.
- **What makes a good test here.** External behavior only: a candidate without a required component is
  rejected with a reason naming that component; the installer exits non-zero and names the component
  and the configuration file; a status frame for an unconfigured feature carries needs-configuration
  and never claims ready or idle. No test asserts on internal helpers or on message wording that is
  not part of the contract.
- **Modules under test.** Runtime release composition validation and the installer's voice and Hosted
  Pi control install steps; the renderer's voice status and Pi sessions state mapping.
- **Prior art.** `runtime/linux/tests/runtime-release.test.js` builds a temporary runtime root and
  release directories and asserts preflight and activation outcomes; `tests/voice-agent-deployment.test.js`
  sources the installer scripts with stubs and asserts both content and forwarded arguments;
  `tests/voice-status.cjs` and the Pi sessions suites drive the existing state contracts.
- **Existing scenario that changes.** `voice-agent.feature`'s "Voice activation cannot block the shell"
  conflates installation with runtime configuration. It is replaced by two scenarios: an uninstallable
  required component fails the installation, and an unconfigured or unplugged feature keeps the base
  Shell usable.

## Out of Scope

- Entering credentials, endpoints, or Pi targets in the Shell. Configuration stays device-local.
- Blocking the Shell, or showing a blocking error surface, when a required feature is unconfigured or
  unavailable.
- The S3 Remote Control peripheral, Remote Bridge, and Remote Link: a different capability with its
  own acceptance gates, unaffected by this classification.
- The P4 Camera Peripheral's hardware acceptance, which stays independent.
- Parity work on the preserved P4+C6 research platform, and macOS launch agent behavior beyond keeping
  the documented template consistent with the required-component rules.
- Redesigning the voice or Pi sessions interfaces beyond the state and framing changes above.

## Further Notes

- Evidence from the device: both services already run from `/opt/open-deskos/current`, the voice
  service now follows release updates (its versioned personal-release override was retired), and the
  Hosted Pi control unit is generated by the installer with the stable path.
- The failure modes that motivated the recent release work are recorded in `ADR 0017` (release
  toolchain is declared by the release) and `ADR 0018` (releases are reclaimed by pointer reference).
  Because voice now follows releases, a voice regression in a release reaches the desk directly —
  which is exactly why the release gate must require it.
- `MANAGED_TASKS.md` and `VOICE_AGENT_DEPLOYMENT.md` are updated with this decision: the components are
  required and staged by the installer, and their services start once the host is configured.