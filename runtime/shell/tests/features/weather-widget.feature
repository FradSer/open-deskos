Feature: Weather instrument on the Home grid
  Scenario: Hidden weather acceptance renders at each requested viewport
    Given the comparison window stays hidden on a supported Shell Host
    When each of the five standard sizes loads a new Shell document
    Then rendering continues without showing the host window
    And the document uses the requested width and height after loading
    And its device scale and page zoom are one before measurements
    And Linux comparisons select software rendering before Electron is ready
    And other hosts retain their rendering selection
    And the complete layout matrix uses an offscreen painting window
    And existing per-operation deadlines and density tolerances remain unchanged

  Scenario: Weather replacement preserves measured density
    Given the default and trusted selected surfaces show the same Weather state
    When the existing collector measures both surfaces after fonts settle
    Then both use the shared Weather density profile
    And measurements cover all five standard viewport sizes
    And density, clipping, and content remain compatible across the existing state, theme, and size matrix

  Scenario: Actual Main starts signed Weather sources and surfaces together
    Given signed independent source and surface selections share one publisher policy
    When production Main starts after surface update, rollback, or removal
    Then actual preload and Renderer discovery load the selected source and surface
    And selected and executed surface revisions agree
    And source readings and visible Weather content remain unchanged
    And normal quit removes source handlers and signed surface protocol leases

  Scenario: Signed Weather surface revisions preserve separate process consumers
    Given independent source and surface selections share an external publisher policy
    When the Native CLI updates, rolls back, and removes the surface selection
    Then each selection executes in a different Electron process
    And the executed surface revision matches the selected signed entry
    And all rendered Weather states remain equal to the default surface
    And invalid updates preserve configuration and unaffected source preferences
    And removal restores the default surface while retaining signed revisions

  Scenario: Weather acceptance keeps CLI processes under parent ownership
    Given the parent prepares trusted source and surface selections
    When the Electron consumer attempts to launch a CLI subprocess
    Then the fixture refuses that launch
    And cancellation joins parent-owned CLI processes before removing private state

  Scenario: Signed independent Weather surfaces use captured verified assets
    Given the Native CLI installs an independent Weather surface with publisher policy and explicit trust
    When actual Renderer discovery captures its signed entry and stylesheet
    And the stored entry and stylesheet change before browser loading
    Then actual preload consumers retain the same rendered Weather state matrix
    And the selected surface executes without the default mount
    And discovery shutdown releases its signed asset protocol lease

  Scenario: Independent Weather surfaces preserve shared display and release behavior
    Given default and independently loaded Weather surfaces use the same visual assets
    When controlled status responses cover waiting, live, stale, unavailable, unconfigured, and malformed states
    Then place, readings, units, conditions, daily range, glyphs, and status notices remain unchanged
    And both surfaces request cached status before forced refresh and use the shared tick cadence
    And released responses cannot write or start another request
    And a trusted development entry mounts through actual Renderer discovery and the registry
    And supported themes and compact or wide cells preserve complete content and readable geometry

  Scenario: Released Weather surfaces cannot publish late readings
    Given a mounted Weather Widget has a pending cached or forced status request
    When the Renderer registry releases or disables that surface
    Then later successful or rejected responses cannot change the released element
    And a released cached request cannot start the chained forced refresh
    And stale tick callbacks cannot start new requests
    And enable restores a fresh Widget while the old response remains isolated

  Scenario: Device relocation preserves the identity of Weather readings
    Given a Weather request is pending for the first device location
    When a refresh resolves a different device location
    Then the earlier response cannot publish or persist a reading for the new location
    And the new request waits for the earlier request to settle
    And its result and cache use the coordinates and label that started that request
    And an older location lookup cannot replace a newer lookup result
    And cancellation while waiting prevents the new request from starting
    And concurrent device lookups preserve a shared reading
    And a later ordinary refresh cannot suppress an explicitly forced refresh


  Scenario: A place-led instrument separates the reading from its supporting group
    Given the Home grid shows weather for Shenzhen
    When the tile renders in Instrument, Pixel, Border Beam, or Liquid Glass
    Then the header names Shenzhen instead of repeating Weather
    And a successful reading has no Live label or refresh time
    And the current temperature holds its own row under the header, with its unit attached
    And the condition and the sky it names share one supporting row below the reading
    And the daily range is one high-first pair with H: and L: beside their values
    And the supporting row takes the tile's width so the reading is not left in a corner
    And the tile remains display-only
    And its weather condition is discoverable through the shared Widget state role

  Scenario: A compact cell keeps the same composition at smaller type
    Given the Home grid gives the Weather tile a cell whose inner width is 220 pixels or less
    When the tile renders in any state
    Then the place steps down to the caption floor while the condition keeps the data floor
    And the sky steps down to one whole unit of the pixel set
    And the range values step down with the cell
    And the condition, the sky and the range stay on the tile's own supporting row
    And the reading stays above them without overlapping

  Scenario: A long place and an outage cannot overlap the reading
    Given a source publishes a twenty-column place while no reading is available
    When the tile renders in a cell whose inner width is 220 pixels or less
    Then the place takes at most two lines and keeps its complete value in the element
    And the reading keeps a floor of its own row instead of collapsing into the condition
    And the condition and the range stay inside the tile

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
    Then the pair reads high then low as one line
    And both labels take the supporting role and both values take the primary role
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

  Scenario: A host that was given a location never asks a location service
    Given ODK_WEATHER_LAT and ODK_WEATHER_LON are set in the desk's environment
    When the weather source starts
    Then it uses the configured latitude and longitude and place label
    And the device-location provider is never called
    And the snapshot reports the location came from configuration
    And the configured host stays usable while offline

  Scenario: A host without a configured location asks a location service once
    Given no weather location is configured on this host
    When the weather source resolves a location
    Then it calls the device-location provider once with a bounded timeout
    And it caches the provider's latitude, longitude and city
    And it uses the returned coordinates with the provider's city as the place label
    And the snapshot reports the location came from the device

  Scenario: A location answer without a city invents no name
    Given no weather location is configured on this host
    When the device-location provider answers with coordinates but no city
    Then the place label falls back to the coordinate rule
    And no city name is invented

  Scenario: A failed location lookup never guesses a city
    Given no weather location is configured on this host
    When the device-location provider fails, times out, or returns nonsense
    Then the source keeps a truthful unavailable state with a reason
    And no guessed city reaches the renderer

  Scenario: A fresh cached location is reused
    Given the device-location provider answered within the refresh interval
    When the weather refreshes
    Then the provider is not called again
    And the cached coordinates and city remain in force

  Scenario: The weather state says where the location came from
    Given the weather source publishes any snapshot
    Then the snapshot names configured or device as the location origin
    And an unconfigured host reports no location origin

  Scenario: An explicit desk location overrides an IP exit city
    Given the desk location is configured as Wuhan
    And the IP location provider would return Taipei
    When the weather source refreshes
    Then the weather request uses the Wuhan coordinates
    And the device-location provider is never called

  Scenario: Weather cache belongs to its coordinates
    Given a cached weather reading for Taipei
    When the desk location changes to Wuhan
    Then the Taipei reading is not shown as Wuhan weather
    And a provider failure leaves Wuhan unavailable

  Scenario: Linux complete weather comparison has a bounded workload budget
    Given the complete comparison loads forty size and theme combinations
    When it runs on Linux
    Then its fixture has a 75 second aggregate watchdog
    And its child process has a 85 second deadline
    And its ordinary parent has a 120 second deadline including preparation
    And its four-process surface revision parent has a 360 second deadline
    And source-only revision fixtures retain their 45 second watchdog
    And each readiness check retains its four second deadline
    And other hosts retain their existing aggregate deadlines

  Scenario: The primary temperature keeps its readable floor
    Given the weather reading has a constrained vertical lane
    When the active theme calculates the primary temperature size
    Then the primary reading remains at least 14 pixels
    And supporting captions retain their separate readable floor

  Scenario: Current temperature remains the primary Weather reading
    Given live or stale weather includes a current temperature and a daily range
    When the Widget renders across four themes and supported Cell sizes
    Then the current temperature is at least one and a half times the daily range text size
    And the high and low remain readable supporting values
    And negative and multi-digit readings preserve this hierarchy
    And default and independent Weather surfaces enforce the same hierarchy

  Scenario: Weather geometry uses readable font metrics on each host
    Given Windows and CM5 render the same Weather contract
    When long conditions or compact Cells constrain the reading
    Then the primary numeral and unit do not overlap the place or condition
    And the primary numeral uses the bundled display font outside Pixel
    And Pixel retains its regular pixel font
    And deferred profile cleanup cannot replace a failed geometry verdict
