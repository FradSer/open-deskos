Feature: Calm Pi session reading
  Scenario: Stable session reading with running sessions first
    Given several workspaces and sessions are displayed
    And the reader has scrolled to a session and expanded its details and files
    When the source changes session order and a preceding goal grows
    Then running sessions appear before settled or exited sessions
    And existing session order within each state stays unchanged
    And the same session stays at the same viewport offset with disclosures and focus preserved
    And updated goals and statuses remain fresh

  Scenario: Newly discovered sessions do not displace existing sessions
    Given the reader is viewing existing workspaces
    When refresh includes a new session and a new workspace ahead of existing data
    Then the new session is appended within its workspace
    And the new workspace is appended after existing workspaces

  Scenario: CM5 text is readable without changing the theme
    Given the Pi monitor is displayed at 1920 by 1280
    Then goals use at least 28px text and workspace titles at least 26px
    And supporting metadata uses at least 18px text
    And long goals and paths wrap inside the session surface
