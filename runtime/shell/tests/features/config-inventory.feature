Feature: The configuration inventory names every runtime setting

  Scenario: A setting read at startup is inventoried
    Given the Personal Agent selects a resident model through ODK_PERSONAL_AGENT_MODEL
    When the inventory scans runtime, scripts, and integration sources
    Then the setting appears in docs/CONFIGURATION.md with its real consumer
    And the inventory reports no undocumented variable in a development checkout or a sealed release
