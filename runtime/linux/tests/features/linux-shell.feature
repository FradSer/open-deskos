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
    Given the Display Shell is focused on the first of three pages
    When it receives an ArrowRight key press
    And it receives another ArrowRight key press after the prior navigation completes
    Then it displays the third page

  Scenario: Linux network and Remote Link status remain separate
    Given the Linux shell is running
    Then the network indicator only describes network reachability
    And the peek shows OpenCode Go readiness and network state
    And Remote Link states remain disconnected, USB, wireless or synchronizing
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
    Then the status bar, three-column widget grid and peek are visible
    And every visible widget states a truthful status before any App opens
    And the grid remains inside the viewport at alternate window sizes

  Scenario: CM5 1080P HDMI shell has a balanced widescreen desk instrument layout
    Given the shell starts at 1920 by 1080
    Then the status bar, three-column widget grid and peek are visible
    And the layout provides balanced card proportions without horizontally stretched rows
    And Today, Home, and Usage pages provide structured, centered desk instrument views
    And the grid remains inside the viewport at alternate window sizes

  Scenario: Widget interaction display logic distinguishes operable apps from glanceable instruments
    Given the Home grid displays registered widgets
    Then interactive widgets declaring open-app render as interactive controls with action affordances and active feedback
    And display-only widgets render as non-interactive instruments with glanceable badges and without hover actions
    And interactive widgets are keyboard-focusable and open their declared built-in view on tap
    And display-only widgets remain read-only without opening modal views

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
    Then Today, Home, Usage, direct touch, and keyboard navigation remain available
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


  Scenario: Linux shell validates the built-in view intent seam
    Given a widget declares an App continuation
    When the user taps the widget
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
    And Remote Link state is shown independently from OpenCode Go status

  Scenario: Renderer UI is English-only
    Given the Linux shell is loaded
    Then all visible Today, Home, Usage, dialog, status, and service copy is English
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

  Scenario: Built-in composition rejects invalid continuations before release activation
    Given a candidate runtime contains its built-in plugins and desktop layout
    When release preflight validates the composition contract
    Then every plugin has a unique supported identity, kind, and lifecycle
    And every layout entry references a compatible plugin
    And every open-app tile references a valid built-in App
    But no third-party plugin or theme code is loaded

  Scenario: Built-in composition accepts only fixed visible plugin kinds
    Given a candidate runtime contains its locally packaged built-in plugins
    When release preflight validates the composition contract
    Then it accepts only tile, page, status, peek, and app plugins with schema version 1
    And it rejects unsupported kinds and invalid tile or status declarations
    And no generic plugin backend RPC or automatic widget placement is available


  Scenario: Peek opens a focused factual system status view
    Given the Display Shell is running with available or unavailable provider and Remote Link state
    When the user selects the peek
    Then a focused status view shows provider, network, Remote Link, and foreground-view state
    And it offers only supported recovery actions
    And Back or Escape restores the source page and page position

  Scenario: CM5 acceptance identifies release and hardware evidence separately
    Given an Open DeskOS release is installed on a CM5
    When the acceptance command runs
    Then it emits one JSON report for release, migration, kiosk, service, smoke, display, and touch evidence
    And unavailable hardware checks are not reported as accepted
    And host validation does not claim CM5 hardware acceptance
