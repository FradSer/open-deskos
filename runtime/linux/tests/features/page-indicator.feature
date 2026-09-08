Feature: Theme-aware Apple-style State Bar page control

  Scenario: Page navigation stays visually quiet
    Given the shell has four configured pages
    When the State Bar renders at desktop or compact width
    Then a centered subtle capsule contains four evenly spaced markers
    And the current page is a brighter short bar while other pages are points
    And no visible page labels or segmented text buttons are shown
    And page names and the current position remain available to assistive technology
    And each independent button is at least 28 by 44 pixels

  Scenario: State Bar capsules share one height
    Given the State Bar displays Pi status and the page indicator
    When the window changes size or switches among Instrument, Border Beam, and Pixel
    Then both capsules use the same 44 CSS pixel height
    And their visible top and bottom edges are aligned
    And the page indicator's visual background fills its full click-target height
    And the shared height does not change when the current page changes

  Scenario: Live theme changes preserve page navigation
    Given a page is selected and its indicator has keyboard focus
    When the theme changes among Instrument, Border Beam, and Pixel without reloading
    Then Instrument and Border Beam render circular points and a rounded active bar in a capsule
    And Pixel renders square points and a rectangular active bar in a matching square-edged surface
    And the active marker uses the selected theme's foreground accent
    And the page, focus, button identities, and hit areas remain unchanged
    And the theme does not add decorative animation to page indicators

  Scenario: Navigation remains reachable at every size
    Given the shell is between 320 and 1920 CSS pixels wide or zoomed to 200 percent
    When a pointer selects each page indicator
    Then exactly one indicator exposes aria-current and selected styling
    And the capsule and hit areas remain centered between the Pi status and clock
    And selecting a page does not move or resize the capsule or its neighbors
    When the keyboard activates an indicator with Enter or Space
    Then the requested page is selected immediately and keyboard focus remains visible
    When Remote input selects an adjacent page
    Then the marker and assistive current-page announcement update together

  Scenario: Indicator feedback follows input preferences
    Given page navigation is available in any theme
    When pointer feedback is shown
    Then only marker opacity transitions for at most 150 milliseconds
    And neither marker geometry nor button hit areas scale
    When reduced motion is requested
    Then indicator transitions are disabled
    And the current page retains its distinct color and accessible state
