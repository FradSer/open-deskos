Feature: Read AI quotas with clear provenance and recovery
  Scenario: Decide which subscription needs attention at a glance
    Given subscriptions with healthy, low, exhausted and unknown quota windows
    When I open Usage
    Then each subscription shows a textual state based on its known windows
    And exhausted takes precedence over low and unknown
    And the account identity and plan precede the quota windows
    And reset credits are available through a native disclosure below the windows
    And refreshing preserves expanded disclosures

  Scenario: Distinguish subscriptions with different content heights
    Given two Codex subscriptions with 5 hour and weekly limits
    And an Antigravity subscription with several model groups
    When Usage is displayed inside the fixed-height Shell page
    Then the heading reports 3 subscriptions
    And each subscription has its own visible boundary and natural height
    And quota windows precede optional reset credits
    And all model groups remain reachable by vertical scrolling without overlap
  Scenario: Compare remaining quota windows
    Given provider accounts with plans, quota groups and reset credits
    When I open Usage
    Then provider names precede authentication filenames
    And every percentage explicitly describes remaining quota
    And reset times and credit expiry remain visible

  Scenario: Unknown is not exhausted
    Given a quota with a missing or invalid percentage
    When Usage renders it
    Then it says Unavailable and does not expose a numeric meter
    And a real zero remains a numeric exhausted quota

  Scenario: Refresh and recover
    Given previously retrieved accounts
    When a refresh is pending
    Then the accounts remain visible and Refresh quotas is busy
    When refresh rejects
    Then a persistent recovery message appears and refresh is enabled again

  Scenario: Partial and unavailable data
    Given an unavailable account beside a healthy account
    When Usage renders
    Then the failed account is explicitly unavailable without hiding the healthy account
    And service configuration and authorization failures explain recovery

  Scenario: Adaptive reading
    Given long English and CJK account names and multiple quota groups
    When Usage is shown at compact and CM5 widths in each supported theme
    Then text and controls remain contained and readable
    And refresh has a visible keyboard focus indicator
