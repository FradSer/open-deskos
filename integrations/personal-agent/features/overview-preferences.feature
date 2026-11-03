Feature: Owner-configured Overview preferences
  The resident Personal Agent reads one owner preference file.
  The file changes selection, never the displayed facts.

  Scenario: A required source stays visible
    Given the owner requires the Futu holding in Overview
    And a live Futu reading declares the daily change
    When Overview selects its current facts
    Then the compiled Overview includes the Futu daily change
    And the displayed value comes from the current local reading

  Scenario: Pi sessions never disclose their work
    Given the owner forbids Pi session details in Overview
    And five Pi sessions report goals, projects and activity
    When Overview selects its current facts
    Then no Overview text contains a session goal, project or activity
    And an aggregate count of running sessions remains available

  Scenario: A malformed preference file keeps the default policy
    Given the owner preference file contains an invalid rule
    When the resident agent loads the preference file
    Then Pi session details stay private
    And no source gains a required display slot

  Scenario: Every installation names the client without device configuration
    Given a fresh host has no configured Pi model gateway headers
    When the resident agent makes a chat, completion or judgment request
    Then the request identifies its client as Open deskOS
    And the header escapes the space so the Usage view shows Open deskOS
