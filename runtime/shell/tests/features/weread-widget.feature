Feature: WeRead highlight widget
  Scenario: Excerpts use reading type rather than display headlines
    Given a short excerpt has room to grow inside its Widget
    When the copy width is 480 pixels or less
    Then the excerpt uses at most 24 pixel type
    When the copy is wider
    Then the excerpt uses at most 36 pixel type
    And complete text can still shrink or scroll when space is limited

  Scenario: Hidden weread acceptance renders at each requested viewport
    Given the comparison window stays hidden on a supported Shell Host
    When each of the five standard sizes loads a new Shell document
    Then rendering continues without showing the host window
    And the document uses the requested width and height after loading
    And its device scale and page zoom are one before measurements
    And Linux comparisons select software rendering before Electron is ready
    And existing per-operation deadlines and density tolerances remain unchanged

  Scenario: WeRead replacement preserves standard density and long excerpt access
    Given default and trusted selected surfaces display the existing shared density excerpt and title without optional metadata or cover
    When fonts settle at each standard viewport size and theme
    Then both satisfy the existing shared WeRead density profile
    And their fill, occupied area, and empty-band measurements agree
    And the existing long excerpt scenarios retain keyboard access to all text

  Scenario: Actual Main jointly starts independent WeRead source and surface
    Given signed source and surface selections share one external publisher policy
    When actual Main starts after surface update, rollback, and removal
    Then selected and executed revisions agree in separate Electron processes
    And the actual preload and mounted Widget preserve highlight text and metadata
    And later processes retain cache bytes without provider credentials or API requests
    And shutdown releases source IPC, discovery IPC, and signed asset routes

  Scenario: Signed WeRead surface revisions preserve separate process consumers
    Given independent source and surface selections share one external publisher policy
    When the Native CLI updates, rolls back, and removes the surface selection
    Then each selection executes in a different Electron process
    And selected and executed surface revisions agree
    And rendered states, covers, and keyboard scrolling remain unchanged
    And invalid updates preserve configuration and unaffected preferences
    And removal restores the default surface while retaining signed source and surface versions
    And the process writes its complete consumer report before exit
    And later processes read retained highlights without provider credentials or cache changes

  Scenario: Signed WeRead surfaces load captured verified code and styles
    Given the Native CLI installs an independent surface with publisher policy and explicit trust
    When actual Renderer discovery captures its signed entry and stylesheet
    And stored code and styles change before browser loading
    Then actual preload consumers retain text, decoded cover pixels, and keyboard scrolling
    And the independent surface executes without the default mount
    And shutdown removes discovery IPC and releases the signed asset protocol

  Scenario: Independent WeRead surfaces preserve display and resource behavior
    Given default and independent WeRead surfaces use shared layout and stylesheet assets
    When source responses, cover decoding, themes, fitting, and ticks update the Widget
    Then excerpts, metadata, decoded covers, and keyboard scroll behavior remain unchanged
    And release cancels fitting and image callbacks and disconnects resize observation
    And failed observer release remains retryable
    And late reading responses cannot change a remounted Widget
    And actual trusted Renderer discovery loads the independent implementation without the default mount

  Scenario: Released WeRead instances cannot change a remounted Widget
    Given a mounted WeRead Widget has pending reading and cover responses
    When the renderer releases the Widget and mounts it again
    Then it disconnects the old resize observer and cancels scheduled fitting
    And old reading success or failure cannot replace the new content
    And old cover callbacks cannot draw or hide the new cover
    And the new Widget receives its own resize observer and reading updates
    And the shared Main provider retains its service-owned lifecycle

  Scenario: WeRead release retries failed observer cleanup
    Given disconnecting the WeRead resize observer fails once
    When the renderer retries release
    Then it retries the retained observer cleanup
    And late reading responses remain unable to change the released Widget

  Scenario: WeRead draws only the currently selected cover
    Given two cover loads finish in reverse order
    When the newest cover has rendered
    Then the older cover cannot replace or hide it
    And removing the cover prevents previous callbacks from showing it again

  Scenario: Pending cover decoding survives repeated ticks
    Given the current cover image has not finished loading
    When the shared tick repeats without a source or theme change
    Then the Widget retains that image load until it completes
    And a theme change supersedes it once
    And a failed load for a changed theme remains eligible for retry

  Scenario: Long excerpts remain readable at the minimum text size
    Given a complete WeRead excerpt exceeds the available cell height at fourteen pixels
    When the Widget fits the excerpt
    Then its excerpt area permits vertical scrolling to the last character
    And the book metadata and cover remain inside the Widget
    And the complete source text remains unchanged

  Scenario: Focused excerpt retains keyboard scroll ownership
    Given a focused WeRead excerpt exceeds its visible height
    When the reader presses End and then Home
    Then the excerpt reaches its last character and returns to its start
    And the Shell stays on the Reading page
    And Escape and horizontal navigation retain their Shell behavior

  Scenario: Excerpt fitting uses the resolved layout gap
    Given the WeRead copy has a resolved row gap larger than the fitting fallback
    When the Widget fits its excerpt beside the book metadata and cover
    Then fitting reserves the actual row gap before it selects the readable text size
    And the excerpt remains vertically contained without changing its text

  Scenario: Home keeps chatbot and settings while Reading hosts WeRead
    Given the home layout is loaded
    Then it contains the chatbot and settings widgets
    And the reading page hosts the WeRead widget spanning three columns and two rows anchored top-left

  Scenario: WeRead widget shows the latest personal highlight
    Given the WeRead API returns recent highlights
    When the WeRead widget refreshes
    Then it displays the book title and latest highlighted text

  Scenario: WeRead widget rotates through recent highlights
    Given the WeRead widget has shown the latest highlight
    When the WeRead widget refreshes again before resync
    Then it displays the next recent highlight instead of repeating the same one

  Scenario: WeRead meta splits into title, author, and date lines
    Given the WeRead widget shows a highlight with title, author, and creation date
    When the WeRead widget renders it on the reading page
    Then the title and author appear on separate lines without book-title brackets
    And the creation date appears below without an underline
    And the cover renders beside the meta block preserving its original aspect

  Scenario: WeRead meta steps down by the golden ratio
    Given the WeRead widget is rendered in a wide grid
    Then the title and author sizes step down by phi
    And the author and date share one size separated by spacing

  Scenario: WeRead hero text dominates with calm spacing
    Given the WeRead widget is rendered in a wide grid
    Then the highlight text owns the top with clear size contrast against the title
    And a hairline separates the text from the meta row

  Scenario: WeRead widget reports missing credentials honestly
    Given the WeRead API key is unavailable
    When the WeRead widget refreshes
    Then it displays that WeRead is not configured

  Scenario: WeRead content stays readable inside its tile at every density
    Given the WeRead widget is rendered in a wide or compact grid
    Then its identity, status, title, and highlight remain inside the tile bounds
    And the content is vertically balanced without fabricated highlight data

  Scenario: WeRead highlight scales to fit the tile without clipping
    Given a highlight whose text is longer than the tile can show at base size
    When the WeRead widget renders it on the reading page
    Then the quote font size shrinks until its content fits or reaches the readable minimum
    And the font size never drops below the readable minimum
    And any remaining excerpt overflow stays scrollable without hiding the book metadata

  Scenario: Reading excerpt has a restrained display scale
    Given a short highlight on the wide reading page
    When the widget fits its text
    Then standard excerpts use at most 72 pixels
    And a full three-by-three canvas can use at most 96 pixels
    And the cover appears to the right of the book details
    And the source cover remains subordinate to the excerpt

  Scenario: Reading uses at most three responsive text sizes
    Given a highlight with a title, author, and date
    When the reading widget changes width
    Then the excerpt font size adapts to the available space
    And the title has one supporting size
    And the author and date share the same smallest size

  Scenario: Reading excerpt uses the shared widget inset
    Given the reading widget is displayed on the desktop
    Then the excerpt and source row use the shared widget inset
    And neither side reserves more than 28 pixels of padding

  Scenario: Book attribution remains legible at desk distance
    Given the reading widget is approximately 1100 pixels wide
    Then the book title is approximately 36 pixels
    And the author and date share an approximately 22 pixel size
    And the right-side cover is approximately 132 pixels wide with its original aspect ratio

  Scenario: Pixel cover preserves finer book details
    Given the book cover is rendered in the Pixel theme
    Then the pixel treatment uses 2 pixel blocks
    And the cover uses a mild contrast and saturation treatment

  Scenario: Linux complete weread comparison has a bounded workload budget
    Given the complete comparison loads thirty size and theme combinations
    When it runs on Linux
    Then its fixture has a 90 second aggregate watchdog
    And its child process has a 100 second deadline
    And its ordinary parent has a 130 second deadline including preparation
    And its four-process surface revision parent has a 420 second deadline
    And source-only revision fixtures retain their 45 second watchdog
    And each readiness check retains its four second deadline
    And other hosts retain their existing aggregate deadlines
