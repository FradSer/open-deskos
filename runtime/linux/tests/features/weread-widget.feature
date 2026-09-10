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
