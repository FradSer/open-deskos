Feature: Independent instrument refinement
  Each display instrument preserves its established visual hierarchy.

  Scenario: Sequential verification remains in the recurring end-to-end gate
    Given the runtime end-to-end gate is run
    When its subprocess checks execute
    Then sequential instrument and App checks must pass for the gate to pass

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
    When it reports starting or no frame
    Then the primary reading says "Starting" or "No frame"

  Scenario: Hydra removes an offline plant's live meter
    Given a plant previously reported soil moisture while online
    When that plant goes offline
    Then its soil reading is unavailable and its meter is empty
    When that plant disappears from the snapshot
    Then no watering emphasis remains

  Scenario: Calendar App shows the current local date without invented events
    Given Calendar is mounted with the shared clock
    When local midnight crosses a month boundary
    Then its semantic date updates to the new date
    And event data remains explicitly unavailable

  Scenario: Clock App preserves its semantic minute reading
    Given Clock is mounted with the shared clock
    When ticks arrive within a minute and then cross midnight
    Then unchanged text is preserved and the semantic time advances to "00:00"
    And the reading is not a live announcement

  Scenario: Year App shows locally calculated year progress
    Given Year progress is mounted with the shared clock
    When the local year changes
    Then its percentage resets from the end-of-year reading to "0%"
    And its description names the current local year

  Scenario: Catalog search preserves loading and failure states
    Given the built-in view catalog request is pending
    When text is entered in its search field
    Then the status still says "Loading built-in views."
    When the request fails and search text changes
    Then the load error remains visible with Reload available
    And a routed IPC failure displays the public error "endpoint-unavailable"
    When Reload succeeds
    Then the current search filters the recovered catalog

  Scenario: Your apps remains usable during catalog failure and recovery
    Given Your apps is visible at compact or widescreen geometry
    When its catalog is loading and then fails
    Then loading and unavailable states remain truthful
    When a catalog change notification arrives after recovery
    Then the empty installed catalog returns
    And its input retains focus when a separate App closes by Back or Escape

  Scenario: Built-in views explains empty search results
    Given the built-in view catalog has loaded
    When a search matches no view
    Then the status says "No matching built-in views. Clear search to see all views."
    When the search is cleared
    Then the matching views return and the empty status clears
    When the catalog itself is empty
    Then the status says "No built-in views available."
