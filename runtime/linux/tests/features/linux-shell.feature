Feature: Open DeskOS Linux 外壳(CM5 Electron 切片)

  Scenario: Linux shell fetches OpenCode Go usage natively
    Given the Linux OpenCode Go endpoint and cookie are configured explicitly
    When the shell refreshes native subscription status
    Then the main process requests the endpoint without exposing the cookie to the renderer
    And the quota page displays rolling, weekly, monthly and Zen usage values
    And rejected credentials show an honest unavailable state without placeholder usage

  Scenario: Unconfigured OpenCode Go status remains honest
    Given no OpenCode Go endpoint or cookie is configured
    When the Linux shell starts
    Then the quota page says OpenCode Go is not configured
    And no usage value is fabricated
    And the shell does not render a platform connection guide

  Scenario: Consecutive HID navigation presses advance consecutive pages
    Given the Display Shell is focused on the first of four pages
    When it receives an ArrowRight key press
    And it receives another ArrowRight key press after the prior navigation completes
    Then it displays the third page

  Scenario: Linux network status remains concise
    Given the Linux shell is running
    Then the State Bar shows only a network reachability indicator
    And it does not render Network connected, OpenCode Go readiness, or Remote Link text
    When the network changes offline then online
    Then the indicator and assistive status announcement update accordingly

  Scenario: Today starts as a truthful, usable desk surface
    Given the shell starts at 1920 by 1280
    Then the first page is Today and shows the current weekday, date, and local time
    And Today states the current network, focus, and OpenCode Go configuration status
    And Today does not claim meetings, tasks, habits, steps, sleep, or other personal data without a configured provider
    And Today remains usable when optional experimental integrations are unavailable

  Scenario: CM5 HDMI shell has a responsive Open DeskOS layout
    Given the shell starts at 1920 by 1280
    Then the State Bar and five-column by three-row widget grid are visible
    And the shell exposes four navigable pages with Pi Sessions on page three and Usage on page four
    And every visible widget states a truthful status before any App opens
    And the widget grid has five columns and three rows
    And the State Bar is large enough for the Pi Sessions running state to be legible
    And the grid remains horizontally contained and vertically scrollable at alternate window sizes

  Scenario: The five-column layout reflows safely in a narrow development window
    Given the shell is resized below the widescreen breakpoint
    When the Home grid is rendered
    Then widgets use the narrow responsive grid instead of overflowing desktop coordinates
    And the State Bar retains its network reachability indicator
    And every widget remains horizontally contained and reachable by vertical scrolling

  Scenario: Every page uses the widget grid footprint
    Given the shell starts at 1920 by 1280
    Then the Home widgets occupy the shared grid footprint
    And the Pi Sessions App surface matches that grid width and height
    And the Usage App card matches that grid width and height
    And cards do not use colored top or left edge bars for state

  Scenario: Widgets use a unified signal-capsule information hierarchy
    Given the Home grid displays every built-in Widget
    Then every Widget presents one dominant truthful signal that uses the available card area
    And Widget anatomy may omit generic headers or footers when the signal remains self-explanatory
    And live numerical signals use tabular numerals
    And full-surface state color never replaces a readable text label
    And unavailable capabilities use explicit text instead of decorative empty space
    And decorative charts never imply unavailable data

  Scenario: App pages extend the Widget signal-capsule language
    Given the user navigates to Pi Sessions or Usage
    Then the App surface uses the same radius, border, spacing, typography, and state-color system as Widgets
    And grouped data remains labeled and scannable without nested decorative cards
    And workspace paths, goals, process commands, and status explanations wrap instead of being hidden by ellipsis

  Scenario: Pi Sessions controls remain usable at the minimum portrait size
    Given the shell is resized to 320 by 480
    When the user navigates to Pi Sessions
    Then session filters and refresh controls remain inside the App surface
    And each control remains reachable by touch

  Scenario: Every visible Widget and direct App surface is monitored
    Given the shell starts at 1920 by 1280
    Then every Home Widget stays within the shared grid footprint and exposes a state
    And every direct App surface stays within the shared grid footprint
    And no monitored Widget or direct App surface overflows horizontally
    And the standard Electron E2E command runs the Widget and App interior regression suite

  Scenario: CM5 1080P HDMI shell has a balanced widescreen desk instrument layout
    Given the shell starts at 1920 by 1080
    Then the State Bar and five-column by three-row widget grid are visible
    And Pi Sessions and Usage remain reachable as later App pages
    And the layout provides balanced card proportions without horizontally stretched rows
    And Today, Home, Pi Sessions, and Usage pages provide structured desk instrument views
    And the grid remains horizontally contained and vertically scrollable at alternate window sizes

  Scenario: Home grid fills the available layout with truthful local desk status
    Given the Home grid displays the five-column layout
    When the shell has loaded on the CM5
    Then the layout shows a Desk status widget
    And the widget reports the local shell resolution and ready state
    And it does not require a provider or fabricate personal data

  Scenario: Display widgets and App pages remain separate surfaces
    Given the Home grid displays registered widgets
    Then every Home widget renders as a non-interactive instrument without an App action affordance
    And the Pi Sessions page is a full interactive App surface on page three
    And the OpenCode Go Usage page is a full interactive App surface on page four
    And App controls never appear inside the Home widget grid

  Scenario: Pi Sessions App page exposes every local process
    Given the local Pi session scanner reports running, settled, and exited processes
    When the user navigates to the Pi Sessions page
    Then the page lists every process with workspace, PID, status, and latest goal
    And search, status filters, refresh, and modified-file details remain interactive
    And status filters expose their selected state and session changes are announced
    And an empty scanner result explains that no local Pi sessions were found

  Scenario: OpenCode Go remains an interactive Usage App page
    Given the OpenCode Go endpoint is unavailable or explicitly configured
    When the user navigates to the Usage page
    Then the page exposes an honest provider state and a refresh action
    And configured usage values are shown only when returned by the provider
    And each usage value has a visible label

  Scenario: CM5 root installation leaves the runtime usable by the kiosk user
    Given the CM5 installer runs as root for the graphical kiosk user
    When it installs Node dependencies and regenerates runtime assets
    Then the runtime tree is owned by the graphical kiosk user
    And dependency installation runs as that user
    And the installer resolves pnpm from the installed Node runtime when it is absent from PATH
    And the kiosk can regenerate its tracked stylesheet without a permission error

  Scenario: CM5 installation continues past unrelated apt index failures
    Given apt has cached package indexes for the required Electron libraries
    When an unrelated configured repository fails during apt-get update
    Then the installer reports the update failure and continues to install required runtime packages
    And installation still fails if the required package installation cannot complete

  Scenario: Kiosk launch hides the pointer and prevents X11 DPMS blanking
    Given the shell starts from the graphical autostart session
    When the kiosk launcher initializes
    Then it hides the X11 pointer before starting Electron
    And it disables X11 screen-saver and DPMS blanking before starting Electron
    And an idle HDMI panel remains powered while the shell is running

  Scenario: CM5 shell enables hardware GPU acceleration with configurable software fallback
    Given the CM5 kiosk launcher initializes
    When hardware acceleration is enabled by default
    Then the kiosk launcher does not force software OpenGL
    And the main process configures Chromium to ignore the GPU blocklist and enable GPU rasterization
    And setting ODESK_DISABLE_GPU or LIBGL_ALWAYS_SOFTWARE to 1 forces software rendering fallback

  Scenario: Experimental vision never blocks the desk surface
    Given the Face Agent user service is stopped, starting, has no camera frame, or cannot capture from its camera
    When the Linux shell starts
    Then Today, Home, Pi Sessions, Usage, direct touch, and keyboard navigation remain available
    And experimental Face Agent and P4 owner-recognition integrations do not reveal personal status or gate the shell

  Scenario: Experimental Face Agent consumes only ESP32-P4 inference metadata
    Given the ESP32-P4 camera serial device is unavailable, reconnecting, or sends stale metadata
    When the Face Agent runs on CM5
    Then it opens only the configured ESP32-P4 serial device and never opens a local video device
    And status starts as starting, reports no-frame while the P4 link has no valid record, and reports camera-unavailable after a failed or stale P4 link
    And an online zero-face result remains a truthful no-face result and an online P4 detection remains available to Electron

  Scenario: Experimental vision provisioning is opt-in
    Given Face Agent source code is present under /opt/face-agent
    When the CM5 installer runs with ODESK_INSTALL_EXPERIMENTAL_VISION=1
    Then it provisions the Face Agent virtual environment and P4 camera udev rule
    And it installs and enables the Face Agent user systemd service before kiosk autostart
    But a base CM5 installation succeeds without Face Agent source, models, or P4 hardware

  Scenario: Experimental ESP32-P4 SC2336 camera sub-device connects over USB
    Given an ESP32-P4 sub-device runs the SC2336 camera firmware
    And the sub-device captures video over 2-lane MIPI CSI-2 with SCCB control
    When the ESP32-P4 connects to the CM5 Linux host over USB
    Then the structured face recognition metadata produced by on-device inference is available to the host
    And the Face Agent passes source-tagged detection, identity, and emotion data through its stable loopback status endpoint
    And experimental consumers may render only validated on-device inference results
    And the sub-device has its own hardware acceptance path and does not block the Linux shell


  Scenario: Linux shell keeps the built-in App intent seam available
    Given a status action or built-in view requests an App continuation
    When the user opens that App
    Then the UI emits an open-app intent through preload
    And the main-process built-in view endpoint and renderer runtime handle the intent
    And the modal makes its background inert and exposes a tabbable Back action
    And Back or Escape returns to the source page and route

  Scenario: Linux shell keeps the renderer sandboxed
    Given the shell is loaded
    Then the renderer has no filesystem or Node API
    And OpenCode Go credentials are never exposed through preload
    And the Content Security Policy allows only local renderer assets

  Scenario: USB remote navigation is bounded
    Given the Remote Bridge is connected to the focused shell
    When the remote sends previous or next navigation
    Then the shell changes only to an adjacent page
    And first and last page boundaries remain fixed
    And Remote Link navigation remains independent from OpenCode Go status

  Scenario: Remote Touchpad leaves display pages in bounded paging mode
    Given the focused shell is on a non-interactive Today or Home page
    When the Remote Touchpad sends up, down, primary, or secondary input
    Then the current page remains unchanged
    When it sends left or right input
    Then the shell requests only the adjacent bounded page

  Scenario: Remote control receives a contextual control strip state
    Given the focused shell is on a display browsing page
    Then Remote State Feedback declares browse mode with Previous and Next controls
    Given the focused shell is on an App browsing page
    Then Remote State Feedback also declares a Select control for entering App Focus Mode
    When the shell enters App Focus Mode
    Then Remote State Feedback declares focus mode with directional and Select controls
    And Back remains available in both modes

  Scenario: Remote Touchpad enters App Focus Mode only after selection
    Given the focused shell is on a Pi Sessions or Usage App page in browsing mode
    When the Remote Touchpad sends left or right input
    Then the shell changes only to the adjacent bounded page
    And it does not move an App control focus
    When it sends primary input
    Then the shell enters App Focus Mode at that App's initial focus target
    When it sends a direction
    Then focus moves only among that App's visible enabled controls
    And the displayed page remains unchanged
    When it sends secondary input to a control without a Secondary Action
    Then the App remains unchanged

  Scenario: Remote Back exits App Focus Mode
    Given the focused shell is in App Focus Mode
    When the user taps the persistent Back target on the Remote Touchpad
    Then the shell returns to browsing mode on the same App page
    And left and right input again requests bounded paging

  Scenario: App interaction cannot start pager dragging
    Given the focused shell is on an interactive App page
    When the user touches or uses a control inside that App
    Then the pager transform remains at that App page
    And the App remains responsive to its own interaction

  Scenario: Pager always settles to a whole page after interrupted input
    Given the focused shell begins a page swipe
    When that pointer is cancelled, lost, or a remote page command arrives before release
    Then the pager settles on its current whole page
    And a later page command moves exactly one adjacent page
    And the track transform never remains between pages

  Scenario: The Remote Touchpad always offers Back
    Given the focused shell is in App Focus Mode
    When the user taps the persistent Back target on the Remote Touchpad
    Then App Focus Mode ends without changing the current page
    And a second Back target tap leaves the browsing page unchanged

  Scenario: Remote Touchpad establishes App Initial Focus
    Given the focused shell enters an App page
    Then focus uses that App's declared initial target when available
    But otherwise focus uses its first visible enabled interactive control

  Scenario: Renderer UI is English-only
    Given the Linux shell is loaded
    Then all visible Today, Home, Pi Sessions, Usage, dialog, status, and service copy is English
    And built-in view catalog names are English
    And interactive controls and page indicators have English accessible labels
    And no Chinese characters appear in renderer UI source, catalog values, or end-to-end expectations

  Scenario: CM5 activates only a verified staged Open DeskOS release
    Given a known-good Open DeskOS release is active
    And a complete candidate release is staged outside the active release path
    When the CM5 updater preflights and activates the candidate
    Then it atomically selects the candidate as active
    And it retains the previous release as the rollback candidate
    And it restarts only Open DeskOS-owned services after activation

  Scenario: CM5 retains a usable release after an update failure
    Given a known-good Open DeskOS release is active
    When a candidate release fails preflight or post-activation smoke verification
    Then the failed candidate is not left active
    And the known-good release remains or is restored as active
    And the update result reports the factual failure reason

  Scenario: CM5 runtime migrations are user-scoped and retry-safe
    Given an Open DeskOS migration has not completed for the kiosk user
    When the migration is retried after interruption
    Then it changes only Open DeskOS-owned state exactly once
    And it records completion only after the state is valid
    And base migration does not enable optional vision or Remote hardware

  Scenario: Built-in composition keeps display widgets and App surfaces separate
    Given a candidate runtime contains its built-in plugins and desktop layout
    When release preflight validates the composition contract
    Then every plugin has a unique supported identity, kind, and lifecycle
    And every layout entry references a compatible plugin surface
    And display grid tiles cannot reference an App continuation
    And no System App or bottom Peek surface is registered
    And interactive App pages remain repository-controlled
    But no third-party plugin or theme code is loaded

  Scenario: Built-in composition accepts only fixed visible plugin kinds
    Given a candidate runtime contains its locally packaged built-in plugins
    When release preflight validates the composition contract
    Then it accepts only tile, page, status, and app plugins with schema version 1
    And it rejects unsupported kinds and invalid tile or status declarations
    And no generic plugin backend RPC or automatic widget placement is available


  Scenario: State Bar keeps navigation concise without a bottom Peek
    Given the Display Shell is running with available or unavailable provider and Remote Link state
    When the user looks at the State Bar
    Then it shows its network reachability indicator without provider or Remote Link text
    And no bottom Peek container is rendered

  Scenario: CM5 acceptance identifies release and hardware evidence separately
    Given an Open DeskOS release is installed on a CM5
    When the acceptance command runs
    Then it emits one JSON report for release, migration, kiosk, service, smoke, display, and touch evidence
    And unavailable hardware checks are not reported as accepted
    And host validation does not claim CM5 hardware acceptance

  Scenario: A broken widget cannot take down the shell
    Given a Home grid widget whose mount throws
    When the shell composes the desktop
    Then every other declared page and widget is still built
    And the broken tile shows a truthful error state instead of stale partial markup
    And a widget whose unmount throws does not break teardown

  Scenario: One widget's tick error does not starve the shared tick
    Given a mounted widget whose tick callback throws
    When the shared one-second tick fires
    Then the remaining tick subscribers still receive the tick
    And the shell keeps ticking on the next second

  Scenario: Selected plugins can be disabled by a launch parameter
    Given ODESK_DISABLED_PLUGINS lists one tile, one status, and one page plugin id
    When the shell starts
    Then the listed tile is absent from its grid while every other declared widget still mounts
    And the listed status plugin leaves its slot empty without blocking the other slot
    And the listed page plugin is skipped and pagination counts only the built pages
    And plugin ids that are not declared are ignored
    And with no parameter set the shell builds the full declared layout
