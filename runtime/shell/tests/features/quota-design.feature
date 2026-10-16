Feature: Read AI quotas with clear provenance and recovery
  Scenario: Hidden consumer acceptance uses its private profile on every host
    Given the parent supplies a private Electron profile
    When Electron includes command-line flags in its argument list
    Then the fixture uses the supplied profile for user and session data
    And its hidden window can advance animation frames without showing or taking focus

  Scenario: Decide which subscription needs attention at a glance
    Given subscriptions with healthy, low, exhausted and unknown quota windows
    When I open the AI usage App from its Home Widget
    Then each subscription shows a textual state based on its known windows
    And exhausted takes precedence over low and unknown
    And the account identity and plan precede the quota windows
    And reset credits are available through a native disclosure below the windows
    And refreshing preserves expanded disclosures

  Scenario: Distinguish subscriptions with different content heights
    Given two Codex subscriptions with 5 hour and weekly limits
    And an Antigravity subscription with several model groups
    When the AI usage App is displayed inside the fixed-height Shell page
    Then the heading reports 3 subscriptions
    And each subscription has its own visible boundary and natural height
    And quota windows precede optional reset credits
    And all model groups remain reachable by vertical scrolling without overlap
  Scenario: Compare remaining quota windows
    Given provider accounts with plans, quota groups and reset credits
    When I open the AI usage App from its Home Widget
    Then provider names precede authentication filenames
    And every percentage explicitly describes remaining quota
    And reset times and credit expiry remain visible

  Scenario: Unknown is not exhausted
    Given a quota with a missing or invalid percentage
    When the AI usage App renders it
    Then it says Unavailable and does not expose a numeric meter
    And a real zero remains a numeric exhausted quota

  Scenario: Rendered quota bars retain the numeric reading under the Shell policy
    Given the Shell enforces its existing Content Security Policy
    When the default App or an independent page displays a known quota percentage
    Then the actual bar width matches that percentage
    And a zero reading has no filled width
    And the policy does not require unsafe-inline

  Scenario: Refresh and recover
    Given previously retrieved accounts
    When a refresh is pending
    Then the accounts remain visible and Refresh quotas is busy
    When refresh rejects
    Then a persistent recovery message appears and refresh is enabled again

  Scenario: Partial and unavailable data
    Given an unavailable account beside a healthy account
    When the AI usage App renders
    Then the failed account is explicitly unavailable without hiding the healthy account
    And service configuration and authorization failures explain recovery

  Scenario: Adaptive reading
    Given long English and CJK account names and multiple quota groups
    When the AI usage App is shown at compact and CM5 widths in each supported theme
    Then text and controls remain contained and readable
    And refresh has a visible keyboard focus indicator

  Scenario: The Home Widget states the tightest known window
    Given subscriptions with several quota windows below 25 percent
    And a second account with a healthy window
    When the AI usage Widget reads the shared subscription service
    Then it names the window with the least remaining quota and its percentage
    And its meter carries that percentage for assistive technology
    And the Widget offers no refresh action of its own
    When the user presses the Widget
    Then the App opens and owns the refresh action

  Scenario: The Home Widget states every unavailable reading honestly
    Given the quota service reports unconfigured, unauthorized, or unavailable
    When the AI usage Widget reads the shared subscription service
    Then it states that state as text without a percentage
    And its meter stays empty
    When no account returns a usable window
    Then it states the account count and invents no percentage

  Scenario: The shared Tick preserves current quota readings
    Given the Home Widget has a current quota reading
    When the shared Tick supplies its current Date
    Then the Widget reads the subscription service again
    And failed accounts cannot supply current percentages
    And a reading below 25 percent remains low after display rounding
