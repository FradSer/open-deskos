Feature: Foreground/background App lifecycle
  The canonical App Manager owns lifecycle state. One UI App is foreground at
  a time; Service Apps may continue headless. A stopped App runtime is released
  while its State Store namespace remains available to the Shell.
  Covers: FR-8, FR-9, FR-21; NFR-2; Open DeskOS-OS §5.4

  Scenario: Launching an app from the launcher yields foreground
    Given the Shell is resident with no foreground App
    When the user selects "openai_voice_client_01" to launch
    Then the App Manager transitions the App from installed to running
    And the App runtime receives on_start(ctx)

  Scenario: Closing the app returns to the launcher
    Given "openai_voice_client_01" is the running foreground App
    When the user presses the home button
    Then the App runtime receives on_stop(ctx)
    And the App runtime and App screen are destroyed
    And the Shell-owned State Store namespace remains available

  Scenario: Background app continues headless work
    Given a UI App is foreground and "espnow_sensor_01" is a Service App
    When "espnow_sensor_01" calls its headless service operation
    Then the call proceeds (headless capability allowed)
    And no LVGL write occurs from "espnow_sensor_01"

  Scenario: Background app writing to LVGL is short-circuited
    Given "fancy_widget_02" is a Service App
    When it attempts to access the UI runtime
    Then the operation is rejected without an LVGL write
    And the foreground App screen is undisturbed

  Scenario: App runtime 配额超额启动被拒绝
    Given 已有 manager capacity 个 App runtime 处于存活状态
    When another App requests start()
    Then 启动被拒绝并返回 state 配额错误
    And 既有 App runtimes 不受影响

  Scenario: 反复沙盒违规停止对应 App(FR-21)
    Given "fancy_widget_02" 的 on_tick(ctx) 连续 3 次以沙盒违规失败
    When 第 3 次违规发生
    Then App Manager 停止该 App 并释放其 runtime
    And 其余 App 不受影响

  # Scenario one's original "LVGL XML Component mounted into the compile-time
  # C Screen shell" clause (bdd-specs.md §(d)) is HG-1-gated real-device
  # behavior; this slice covers it equivalently via arbiter-owner transfer +
  # lifecycle callback ordering. "Foreground app sleeping preserves its
  # screen state" (bdd-specs.md §(d)) involves LVGL Screen residency and is
  # deferred to HG-1 (see the design's _index BDD Coverage).
