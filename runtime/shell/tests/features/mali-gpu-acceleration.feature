Feature: Mali GPU acceleration for the CM5 shell

  The CM5 exposes the Mali-G610 through the Rockchip kbase driver and the ARM
  libmali userspace blob. Chromium only accepts the ANGLE GL implementation and
  the blob loses its GPU context when Chromium swaps an X11 window surface, so a
  Mali-backed shell pins ANGLE to GLES/EGL and keeps the display compositor in
  software while rasterization and WebGL run on the GPU.

  Scenario: Mali installation includes the corrected Xorg channel formats
    Given the CM5 uses the supported Debian Xorg package
    When the operator installs Mali userspace
    Then the installer builds glamor from the matching source with its Debian security patches
    And GLES uses BGRA for the 24-bit and 32-bit formats
    And Xorg loads the local module without replacing the distribution module

  Scenario: Installation can run again and removal restores the Xorg configuration
    Given the installer has saved the original modesetting configuration
    When the operator installs Mali userspace again
    Then the original backup remains unchanged
    When the operator removes Mali userspace
    Then Xorg uses its original configuration and distribution module

  Scenario: An Xorg update requires a matching module
    Given the installed Xorg package differs from the supported source version
    When the operator installs or verifies Mali userspace
    Then verification fails before a module from another version is accepted

  Scenario: A historical Xorg log cannot prove a running module
    Given no current Xorg session exists
    And a previous log records the corrected module
    When the operator verifies Mali userspace
    Then verification requires a running Xorg session

  Scenario: A different running module cannot reuse a historical load message
    Given a current Xorg process exists
    And its mapped files do not include the installed corrected module
    When the operator verifies Mali userspace
    Then the historical load message cannot pass verification

  Scenario: Installation finds the kiosk graphical session after terminal sessions
    Given the kiosk user's first session has no Display
    And an inactive closing session still publishes an old Display
    And a later session publishes a Display
    When installation selects the graphical environment
    Then it uses the first nonempty Display from that user's active X11 sessions
    And it does not invent a Display when none is published

  Scenario: The CM5 launcher resets HDMI color conversion
    Given the Shell runs on an X11 CM5 with Mali userspace
    And HDMI-1 supports the Rockchip color properties
    When the kiosk starts
    Then HDMI-1 uses RGB with 8-bit channels
    And a DPMS cycle resets color conversion before screen blanking is disabled

  Scenario: Shell selects the Mali backend on an X11 CM5 session
    Given the ARM libmali userspace blob is installed below /usr/lib/aarch64-linux-gnu/libmali
    And the shell runs on linux arm64 with an X11 display
    When the shell configures Chromium GPU switches
    Then ANGLE is pinned to the gles-egl backend
    And the display compositor stays in software
    And GPU rasterization and WebGL remain enabled

  Scenario: Hosts without the Mali userspace keep the default backend
    Given no libmali userspace blob is installed
    When the shell configures Chromium GPU switches
    Then only the default hardware acceleration switches are applied
    And no ANGLE backend is pinned

  Scenario: A Wayland session keeps the default backend
    Given the shell runs inside a Wayland session on linux arm64
    When the shell configures Chromium GPU switches
    Then no ANGLE backend is pinned

  Scenario: Operators can force a backend explicitly
    Given the operator sets ODK_GPU_BACKEND to mali
    When no libmali userspace blob is installed
    Then ANGLE is pinned to the gles-egl backend
    Given the operator sets ODK_GPU_BACKEND to default
    When the libmali userspace blob is installed
    Then no ANGLE backend is pinned

  Scenario: Software fallback still wins over the Mali backend
    Given ODK_DISABLE_GPU is set to 1
    When the libmali userspace blob is installed
    Then Chromium is started with the disable-gpu switch only
    And no ANGLE backend is pinned
