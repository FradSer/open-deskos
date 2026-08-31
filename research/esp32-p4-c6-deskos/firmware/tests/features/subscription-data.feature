Feature: OpenCode Go subscription data on the launcher
  The launcher Homepage #2 shows the user's real OpenCode Go subscription
  usage (rolling 5-hour window, optional weekly/monthly, Zen credit balance)
  instead of the previous simulated/placeholder ARK + Claude quotas. The
  values are fetched from the host Mac over USB by a host bridge (which
  reads the opencode.ai session cookie from the macOS Keychain and fetches
  the live usage), then pushed to the device over the serial console.

  Scenario: Launcher renders real OpenCode Go usage fields
    Given a subscription snapshot with fields
      | key          | value |
      | plan         | opencode-go |
      | primaryPct   | 62     |
      | primaryResetMin | 18    |
      | weekPct      | 41     |
      | monthPct     | 33     |
      | zen          | 4.20   |
    When the launcher opens Homepage #2
    Then the "OPENCODE GO" usage tile shows the 5-hour window at 62%
    And the weekly meter shows 41%
    And the monthly meter shows 33%
    And the Zen credit row shows 4.20

  Scenario: Opening Homepage #2 requests fresh data from the host
    Given no refresh request is pending
    When the user swipes to Homepage #2
    Then a refresh request is recorded for the host bridge
    And a snapshot pushed while the page is open repaints the meters

  Scenario: No snapshot yet renders a connect-Mac placeholder
    Given no subscription snapshot is stored
    When the launcher opens Homepage #2
    Then the tile shows a "connect Mac" placeholder instead of percentages
    And the host bridge is still invited to refresh

  Scenario: Opening Homepage #2 without the Mac companion does not crash
    Given no subscription snapshot is stored
    And the Mac companion process is not running
    When the launcher opens Homepage #2
    Then the quota page remains visible with the "Connect Mac" empty state
    And the device does not reboot or raise a Lua error

  Scenario: A newly pushed snapshot updates the empty-state reset label
    Given the quota tile previously showed "Connect Mac"
    And a host snapshot arrives without a primaryResetMin field
    When the quota tile refreshes
    Then the primary window shows its real percentage
    And the reset label changes to "5-hr Window"

  Scenario: cerb sub command stores and reports the snapshot
    Given the console is reachable over USB serial
    When the host bridge runs "cerb sub status"
    Then it reports whether a refresh is pending and whether data exists
    When the host bridge runs "cerb sub push plan=opencode-go primaryPct=62 weekPct=41"
    Then the snapshot is stored and the refresh request is cleared
    When the host bridge runs "cerb sub get"
    Then it echoes the stored key=value snapshot
