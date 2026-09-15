Feature: Independent instrument refinement
  Each display instrument preserves its established visual hierarchy.

  Scenario: Clock preserves its reading between minute changes
    Given the Clock is mounted with the shared local-time service
    When ticks arrive within the same minute
    Then the visible time node is not rewritten
    And the reading remains a semantic local time without live announcements
    When local time advances past midnight
    Then the reading and machine-readable time both become "00:00"

  Scenario: Calendar stays stable until the local date changes
    Given the Calendar displays the current local day
    When shared ticks arrive on the same date
    Then its weekday, day and month are not rewritten
    When the local date changes at midnight
    Then all date fields update together

  Scenario: Year progress preserves unchanged readings
    Given Year progress displays its rounded percentage and precise meter
    When another tick leaves both displayed values unchanged
    Then neither reading is rewritten
    When the new year starts
    Then the percentage and meter return to zero

  Scenario: Face presence distinguishes absent recognition from an offline camera
    Given the Face Agent is observing but has not recognized the owner
    When it reports no face or an unknown face
    Then the primary reading says "No face" or "Unknown"
    And it does not claim the observation service is offline

  Scenario: Hydra removes an offline plant's live meter
    Given a plant previously reported soil moisture while online
    When that plant goes offline
    Then its soil reading is unavailable and its meter is empty
    When that plant disappears from the snapshot
    Then no watering emphasis remains

  Scenario: Built-in views explains empty search results
    Given the built-in view catalog has loaded
    When a search matches no view
    Then the status says "No matching built-in views. Clear search to see all views."
    When the search is cleared
    Then the matching views return and the empty status clears
    When the catalog itself is empty
    Then the status says "No built-in views available."
