Feature: Weather instrument on the Home grid

  Scenario: A place-led instrument separates the reading from its supporting sky
    Given the Home grid shows weather for Shenzhen
    When the tile renders in Instrument, Pixel, or Border Beam
    Then the header names Shenzhen instead of repeating Weather
    And a successful reading has no Live label or refresh time
    And the current temperature leads on the left with a smaller sky glyph on the right
    And the condition is directly below the reading
    And Low and High are separate equal columns with labels above their values
    And the unit stays attached to the temperature
    And the tile remains display-only
    And its weather condition is discoverable through the shared Widget state role

  Scenario: The redesigned instrument survives extreme readings and long places
    Given a source publishes a negative or three-digit temperature and a bounded English or CJK place
    When the Home grid is resized through its five supported resolutions
    Then every reading, label and sky glyph stays inside the tile without overlapping
    And supporting text remains at least 12 pixels
    And Pixel artwork keeps whole 24-unit grid multiples after a resize or theme switch

  Scenario: A wide place cannot hide missing daily readings during an outage
    Given the provider accepts a twenty-column place made of wide Latin letters
    And the weather source is unavailable without a cached reading
    When the tile renders at any supported size or theme
    Then the complete place and source state remain readable
    And both daily range placeholders remain inside the tile
    And no condition, temperature, unit or label overlaps another

  Scenario: Every content fixture is checked against the weather density profile
    Given the tile renders loading, live, stale, unavailable or unconfigured weather
    And the place may be wide Latin or CJK and the reading may have one through four characters
    When its rendered content is measured
    Then every fixture is checked against the same 54 to 70 percent envelope band
    And no full-width empty band exceeds 28 percent of the frame height
    And the dedicated numeric-instrument occupied-area floor applies to every fixture

  Scenario: Weather hides refresh metadata without hiding failures
    Given the weather source publishes a reading with an update timestamp
    When the tile renders
    Then no refresh time is displayed in any state
    And a successful reading has no source-status label
    When only a stale cached reading remains
    Then the tile shows Stale without a time
    And its temperature and range stay visible
    When the source recovers
    Then the stale notice disappears without adding a Live label

  Scenario: The tile reports a provider-backed reading
    Given ODK_WEATHER_LAT and ODK_WEATHER_LON configure a location
    When the provider answers with a current temperature, a weather code and a daily range
    Then the tile shows the rounded current temperature with its unit
    And it shows the provider's condition name and sky glyph
    And it shows the daily high and low with tabular numerals
    And no success badge is displayed
    And the place name is the configured one, never a guessed city

  Scenario: A restart shows the last reading before the provider answers
    Given a reading was cached by an earlier run
    When the Shell restarts and the tile mounts
    Then the cached reading is the first answer, marked Stale without a reading time
    And the provider read continues in the background and replaces it
    And the tile never presents an empty instrument while a cached reading exists

  Scenario: A cache keeps the tile truthful across restarts and provider outages
    Given a successful reading was cached
    When the provider fails on the next refresh
    Then the last reading stays visible
    And a Stale notice appears instead of a success badge
    And the snapshot carries the time the reading was taken

  Scenario: Without a location the tile does not invent one
    Given no location is configured
    When the tile mounts
    Then it shows placeholders rather than a temperature
    And the state badge reads Unconfigured
    And the header reads Weather without inventing a place
    And its copy says the location is not set in the desk's own voice
    And the snapshot carries the setting name for the Agent to act on
    And it performs no network request

  Scenario: The tile waits instead of claiming a failure
    Given the tile has mounted and no snapshot has arrived yet
    When the first frame is rendered
    Then it shows placeholders and a Waiting badge
    And it does not claim the source is unavailable
    And no reading, condition, or range is asserted
    When the reply arrives
    Then the tile shows the state the snapshot carries

  Scenario: A compact cell keeps the reading inside the density band
    Given the shell collapses the grid in a 480x854 window
    When the tile renders with a reading and without one
    Then the reading steps down with the compact regime
    And the ink envelope stays inside 54 to 70 percent of the frame
    And no full-width empty band exceeds 28 percent of the frame height

  Scenario: A long place name cannot push the reading out of the tile
    Given a configured place name longer than a tile can carry, including CJK
    When the source publishes its snapshot
    Then the place is bounded and whitespace collapsed before it reaches the renderer
    And an over-long place falls back to the configured coordinates
    And the tile's rows stay inside its frame

  Scenario: A provider failure with no cache is reported as unavailable
    Given no cached reading exists
    When the provider request fails or times out
    Then the tile shows placeholders with the instrument's unit, not an empty unit
    And the state badge reads Unavailable
    And the condition names the missing reading rather than the weather
    And the header still names the place whose reading failed
    And the provider failure stays readable without being shouted on the tile

  Scenario: The provider seam stays bounded
    Given a configured location
    When a refresh runs
    Then the request carries a bounded timeout and is aborted on expiry
    And concurrent refreshes share one in-flight request
    And a reading younger than the refresh interval is served from memory
    And the cached file is written with owner-only permissions
    And malformed provider payloads are rejected instead of rendered

  Scenario: Every weight the tile asks for is one the shipped faces can render
    Given the runtime ships Montserrat Bold only, Noto Sans SC Regular only, and one Zpix weight
    When the tile's stylesheet is read
    Then every rule naming Montserrat asks for 700
    And every rule asking for 400 uses the regular stack instead of a bold-only family
    And a supporting mark is never as heavy as the reading it supports

  Scenario: The daily range treats both values alike
    Given the tile renders the daily high and low
    When the range row is inspected
    Then both labels take the supporting role and both values take the primary role
    And no half of the pair carries an emphasis the other half lacks

  Scenario: The unit sits on the reading's baseline
    Given the tile renders a reading with a unit
    When the reading row is measured
    Then the unit shares the numeral's baseline instead of floating above it

  Scenario: The tile is a display-only instrument
    Given the tile is mounted on the Home grid
    When it renders in Instrument, Pixel, or Border Beam
    Then it uses the shared widget roles and the theme's own face and tokens
    And it exposes no control and no interaction
    And its ink stays inside the density band at every supported resolution
    And it carries no motion

  Scenario: Every provider response shape reaches a truthful state
    Given the provider returns a complete reading, a partial reading, an out-of-range
      temperature, a slow response, or an error
    When the tile renders
    Then each shape maps to a normal reading or a Stale, Unavailable, or Unconfigured notice
    And no state renders a temperature it cannot substantiate

  Scenario: A landing location replaces the tile without contradicting the desk
    Given an installed user Widget occupies the cell the built-in tile now declares
    When the Shell composes the Home grid
    Then the installed Widget reports a placement error instead of sharing the cell
    And the built-in tile renders alone in that cell
    And the desktop status names the widget that needs moving or removing