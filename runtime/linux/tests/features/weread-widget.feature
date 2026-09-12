Feature: WeRead highlight widget
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
    Then the quote font size shrinks until the full text and book title fit
    And the font size never drops below the readable minimum

  Scenario: Reading excerpt has a restrained display scale
    Given a short highlight on the wide reading page
    When the widget fits its text
    Then the excerpt font size is at most 64 pixels
    And the cover and book details form one adjacent source group
    And the source cover remains subordinate to the excerpt
