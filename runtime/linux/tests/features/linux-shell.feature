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

  Scenario: Kiosk launch prevents X11 DPMS from blanking the HDMI panel
    Given the shell starts from the graphical autostart session
    When the kiosk launcher initializes
    Then it disables X11 screen-saver and DPMS blanking before starting Electron
    And an idle HDMI panel remains powered while the shell is running

  Scenario: Experimental vision never blocks the desk surface
    Given the Face Agent user service is stopped, starting, has no camera frame, or cannot capture from its camera
    When the Linux shell starts
    Then Today, Home, Usage, direct touch, and keyboard navigation remain available
    And experimental Face Agent and P4 owner-recognition integrations do not reveal personal status or gate the shell

  Scenario: Experimental Face Agent isolates blocked camera and inference work
    Given the Novatek UVC camera blocks while opening or reading, or face inference stops responding
    When the Face Agent monitor exceeds its worker timeout
    Then the loopback status server continues responding while the child worker is recycled
    And status starts as starting, reports no-frame for an opened camera without frames, and reports camera-unavailable for a timed-out worker
    And an online zero-face result remains a truthful no-face result and an online detection remains available to Electron

  Scenario: Experimental vision provisioning is opt-in
    Given Face Agent source code and model files are present under /opt/face-agent
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
