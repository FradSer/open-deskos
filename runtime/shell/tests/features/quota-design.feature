Feature: Read AI quotas with clear provenance and recovery
  # Source: shared subscription snapshot; percentages mean remaining quota.
  # Keep quota plugin identities, App entry, spans, themes, and cleanup ownership.
  # Use provider headings without new icons; retain existing App provider icons.
  # Verify 186px and 348px Cells, account identity, rotation, and App containment.
  Scenario: Show quota windows for the account plan
    Given Codex Pro, other Codex plans, and Antigravity accounts
    When the Widget or App displays their quotas
    Then Codex Pro hides the 5h window and retains Weekly
    And other Codex plans display 5h and Weekly
    And Antigravity displays 5h and Weekly for each model group
    And missing Antigravity windows remain explicitly unavailable

  Scenario: Account states describe the windows that are displayed
    Given a Codex Pro account with exhausted 5h and healthy Weekly quota
    When the App hides its 5h window
    Then its account state remains Available
    And an Antigravity account with a missing Weekly window states Quota unknown
    And default, development, signed, and restored surfaces retain these states
    And each surface exposes only the numeric meters for displayed windows

  Scenario: Retain a provider's actual short-window duration
    Given an account with a 2 hour short window and a Weekly window
    When the Widget displays its supporting reading
    Then the supporting label retains the supplied 2 hour duration

  Scenario: Read each connected account in the Home Widget
    Given several accounts with known quota windows
    When six visible seconds pass without hover or keyboard focus
    Then the Widget advances to the next account and wraps after the last
    And provider, account, quota, and position change together
    And reduced motion keeps the current account visible
    And the App lists all accounts with provider and email before authentication filenames

  Scenario: Pause account rotation outside the visible desk
    Given a quota Widget on an offscreen page or behind an App
    When the shared Tick continues while the Widget is outside its viewport or its ancestor is inert
    Then the Widget retains its account and visible elapsed time
    And rotation resumes after six accumulated visible seconds

  Scenario: Read multiple accounts in a compact Cell
    Given a 186px Cell and three connected accounts
    When each account is displayed under every theme
    Then provider, state, percentage, account, and position remain at least 14px
    And all readings fit inside the shared content inset
    And the primary percentage uses 40px text in every theme
    And the quota track and fill retain their 6px height
    And the bar width and accessible reading match the displayed percentage

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

  Scenario: The Home Widget states the allowance that governs the period
    Given a subscription states a weekly allowance beside its session window
    And a second account states no window length
    When the AI usage Widget reads the shared subscription service
    Then it names the weekly window and its percentage
    And a short window from another account does not replace the weekly reading
    And the labels follow each supplied window duration
    And its meter carries that percentage for assistive technology
    And the Widget offers no refresh action of its own
    When no account states a long window
    Then it reports the least remaining known quota
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

  Scenario: The Home Widget names the service that owns its quota
    Given a Codex account and an Antigravity account return quota windows
    When the tightest known window changes between accounts
    Then the Widget heading names Codex or Antigravity for that window
    And it never presents CLIProxyAPI as a subscription name
    And missing configuration asks to connect an account without inventing a provider
