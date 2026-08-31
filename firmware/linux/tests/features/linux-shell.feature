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

  Scenario: Linux network and Remote Link status remain separate
    Given the Linux shell is running
    Then the network indicator only describes network reachability
    And the peek shows OpenCode Go readiness and network state
    And Remote Link states remain disconnected, USB, wireless or synchronizing
    When the network changes offline then online
    Then the indicator and assistive status announcement update accordingly

  Scenario: Overview follows the supplied desk-briefing reference layout
    Given the shell starts at 1920 by 1280
    Then the overview places a large weekday and coral status dot at the upper left
    And the overview places month-day and year at the upper right
    And the briefing states “You have 3 meetings, 2 tasks and 1 habit today” with calendar, task, and habit icons
    And the footer states “4.7K steps” and “7.3 hours” with activity and sleep icons
    And the briefing remains above the live peek without overlapping it

  Scenario: CM5 HDMI shell has a responsive Open DeskOS layout
    Given the shell starts at 1920 by 1280
    Then the status bar, three-column widget grid and peek are visible
    And every widget states a truthful status before any App opens
    And the grid remains inside the viewport at alternate window sizes

  Scenario: Kiosk launch prevents X11 DPMS from blanking the HDMI panel
    Given the shell starts from the graphical autostart session
    When the kiosk launcher initializes
    Then it disables X11 screen-saver and DPMS blanking before starting Electron
    And an idle HDMI panel remains powered while the shell is running

  Scenario: CM5 vision is authoritative to the local Face Agent
    Given the Face Agent user service is stopped, starting, has no camera frame, or cannot capture from its camera
    When the Linux shell starts or refreshes Face Agent status
    Then Electron reads only the stable local Face Agent status endpoint at 127.0.0.1:8790
    And the Face presence widget distinguishes unavailable, starting, no-frame, and camera-unavailable Face Agent lifecycle states without inventing a face or identity
    And the Current emotion widget shows that no emotion is available
    And a full-screen privacy shield obscures all shell data until the P4 reports an enrolled owner as unlocked
    When the Face Agent status endpoint reports an online current result for the enrolled owner
    Then the Face presence widget shows only the reported face count
    And the Current emotion widget shows only the reported primary emotion and confidence
    And the privacy shield is removed only when the current P4-selected face has validated unlocked identity data
    And malformed, unreachable, non-success, zero-face, or unknown-face results keep the privacy shield in place

  Scenario: CM5 Face Agent isolates blocked camera and inference work
    Given the Novatek UVC camera blocks while opening or reading, or face inference stops responding
    When the Face Agent monitor exceeds its worker timeout
    Then the loopback status server continues responding while the child worker is recycled
    And status starts as starting, reports no-frame for an opened camera without frames, and reports camera-unavailable for a timed-out worker
    And an online zero-face result remains a truthful no-face result and an online detection remains available to Electron

  Scenario: CM5 provisioning owns the Face Agent lifecycle
    Given Face Agent source code and model files are present under /opt/face-agent
    When the CM5 shell installer runs
    Then it provisions the Face Agent virtual environment with the documented local dependencies
    And it configures the CM5 camera stream by default
    And it installs and enables the Face Agent user systemd service before kiosk autostart
    And the service restarts after failure without changing Remote Link behavior

  Scenario: CM5 supports ESP32-P4 SC2336 camera sub-device over USB
    Given an ESP32-P4 sub-device runs the SC2336 camera firmware
    And the sub-device captures video over 2-lane MIPI CSI-2 with SCCB control
    When the ESP32-P4 connects to the CM5 Linux host over USB
    Then the structured face recognition metadata produced by on-device inference is available to the host
    And the Face Agent passes source-tagged detection, identity, and emotion data through its stable loopback status endpoint
    And the Face presence and Current emotion widgets render only validated on-device inference results
    And the sub-device logic is encapsulated entirely within the Linux companion scope


  Scenario: Linux shell uses the platform intent seam
    Given a widget declares an App continuation
    When the user taps the widget
    Then the UI emits an open-app intent through preload
    And the Installer, App Manager and App Runtime layers handle the intent
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
    Then all visible dashboard, quota, Apps, dialog, status, and service copy is English
    And interactive controls and page indicators have English accessible labels
    And no Chinese characters appear in renderer UI source or end-to-end expectations
