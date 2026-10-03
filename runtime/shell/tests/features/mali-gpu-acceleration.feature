Feature: Mali GPU acceleration for the CM5 shell

  The CM5 exposes the Mali-G610 through the Rockchip kbase driver and the ARM
  libmali userspace blob. Chromium only accepts the ANGLE GL implementation and
  the blob loses its GPU context when Chromium swaps an X11 window surface, so a
  Mali-backed shell pins ANGLE to GLES/EGL and keeps the display compositor in
  software while rasterization and WebGL run on the GPU.

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
    Given the operator sets ODESK_GPU_BACKEND to mali
    When no libmali userspace blob is installed
    Then ANGLE is pinned to the gles-egl backend
    Given the operator sets ODESK_GPU_BACKEND to default
    When the libmali userspace blob is installed
    Then no ANGLE backend is pinned

  Scenario: Software fallback still wins over the Mali backend
    Given ODESK_DISABLE_GPU is set to 1
    When the libmali userspace blob is installed
    Then Chromium is started with the disable-gpu switch only
    And no ANGLE backend is pinned