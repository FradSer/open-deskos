Feature: Widget continuations in the right desk pane
  Scenario: Every Widget opens its App
    Given a populated Home, Desk, or Reading page
    When the user clicks a Widget or presses Enter or Space on it
    Then its App opens in the right pane
    And the resident Agent and State Bar remain visible and usable
    And an upward swipe from the bottom handle restores the source page and Widget focus
    And a paging drag does not open an App

  Scenario: Pi Sessions opens only through its Home Widget
    Given the desktop contains Home, Desk, Pre-order, and Reading
    Then no Pi Sessions App page is mounted in the desktop pager
    And the Home Pi Sessions Widget remains display-only
    When the user activates that Widget
    Then the existing Pi Sessions App opens in the App frame
    And return restores the Home Widget focus
    When the user selects the Pi State Bar indicator
    Then Home opens and the Pi Sessions Widget receives focus
    And no App opens until the user activates the Widget

  Scenario: Native pointer navigation
    Given a Widget has a native App button
    When the user clicks or taps its content
    Then its App opens in each supported theme
    When the user swipes horizontally from the Widget across the page threshold
    Then the next page opens without an App
    And transfer of touch pointer capture does not cancel the swipe
    When the user presses the Widget and releases outside the page
    Then the pending drag is cancelled
    And the next click remains usable

  Scenario: Complete Futu holdings
    Given Futu reports more than three positions
    When the user opens the Futu Widget
    Then the App retains visible separators between holding rows
    And the App shows every position with symbol, price, and daily change
    And the list scrolls vertically inside the right pane
    And refresh preserves scroll position
    And stale, empty, unauthorized, malformed, and unavailable data have explicit states
    And recovery does not require closing the App

  Scenario: Reading canvas and consistent outlines
    Given three square columns fit the right pane
    When the Reading page opens
    Then WeRead occupies three columns and three rows
    And the Pre-order Widget remains reachable on Desk
    And every Widget has an outline in every supported theme
    And Overview has no outline
    And a compact layout keeps every Widget and full App content reachable

  Scenario: Frosted chrome and accessible navigation
    Given the Shell is in a supported theme
    When an App opens or the user changes page
    Then the State Bar has a translucent blurred surface
    And the App has no visible Shell title above its content
    And reduced transparency uses solid surfaces
    And reduced motion keeps navigation immediate
    And keyboard focus is visible without trapping the resident Agent

  Scenario: State Bar directly blurs the desk backdrop
    Given the desk uses the Liquid Glass theme
    When the State Bar is displayed
    Then its full-width surface directly blurs the visible backdrop
    And it has no card outline, rounded frame, inset surface, or shadow
    And the desk backdrop continues behind the State Bar
    And the lower edge has no abrupt color change
    And status readings stay on one row at compact widths
    And the Pi button keeps its keyboard focus and 44 pixel target
    And reduced transparency and forced colors use solid readable surfaces

  Scenario: One bottom handle owns Widget App return
    Given a Widget has opened its App
    Then the App Back button is hidden
    And Escape and taps do not close the App
    When the user swipes upward from the handle below the App card
    Then the App releases its resources and restores the source Widget focus
    And scrolling App content does not dismiss the App
    And short, downward, horizontal, cancelled, and multi-pointer drags do not dismiss it
    And keyboard users can activate the same focused handle
    And failed close retains the App and a usable retry path

  Scenario: A two-finger pinch returns from Shell-owned Widget App content
    Given a Widget has opened its App and no overlay owns input
    When two fingers move inward by at least 48 pixels and one quarter of their initial separation
    And the user releases the gesture without cancellation
    And a 79-pixel initial separation can contract by 48 pixels
    Then the existing App close path restores the source page and Widget focus once
    And parallel two-finger scrolling, spreading, short movement, and three fingers do not return
    And cancellation, resize, lost focus, or modal ownership prevents return
    And ordinary wheel input and Ctrl-wheel retain their existing behavior
    And external frames without the Shell bootstrap retain the Home handle return path

  Scenario: The desk shows a page controller and an App shows the return handle
    Given Home, Desk, or Reading is visible
    Then one page controller sits below the cards with a marker for every page
    And the current page is a brighter marker while every other page is a point
    And every marker target is at least 28 by 44 pixels tall
    And each marker states its page name, position, and page count
    When the user taps a marker, swipes the controller horizontally, or uses its arrow keys
    Then that page opens and the page controller retains keyboard focus
    And cancelled swipes preserve the current page
    When a Widget opens its App
    Then one neutral horizontal return handle replaces the page controller
    And its target is at least 44 pixels high
    And its accessible name names the page the upward swipe returns to
    And forced colors retain a visible page controller and handle
    And the App return marker remains visible both at rest and during a drag
    When the App returns to its source Widget
    Then the page controller returns with the same markers and touch targets
    And theme changes preserve its location and touch target

  Scenario: App and Widget use the same frame
    Given a supported theme and a Widget App
    And the visible source Widget has completed its surface setup
    When the App opens and completes its visible surface setup
    Then the App card has the same border width, color, and radius as its source Widget
    And comparison uses the visible source snapshot and each surface's effective clipped radius
    And a hidden source Widget does not define the comparison after its SDK surface is released
    And surface setup waits remain bounded by the existing acceptance deadline
    And all eight Widgets use the same Shell-owned frame material in each theme
    And no extra active outline or nested runtime border surrounds the App
    And Liquid Glass uses one continuous SDK edge without a second CSS border or inset shadow
    And fallback and accessible modes retain the shared visible CSS border
    And keyboard launch targets retain rounded focus geometry independently of SDK clipping
    And its content remains reachable at compact sizes and 200 percent zoom

  Scenario: Gamepad B returns from a foreground App
    Given a Widget has opened its App and a standard gamepad is connected
    When the user presses B
    Then the App releases its resources and restores the source Widget focus
    And holding B does not repeat the return action
    And a Personal Bot overlay receives B before the App

  Scenario: App chrome preserves the content and accessible name
    Given a Widget has opened its App
    Then no Shell title or empty header occupies space above the App content
    And the App region keeps its accessible name
    And Widget and App frames match in reduced transparency, high contrast, and forced colors

  Scenario: Every Widget opens a content-first App
    Given each of the eight Widgets has opened its App
    And the gallery matches all eight declared Widget identities
    When the App renders at desktop or compact sizes
    Then one shared content inset replaces stacked Shell and App padding
    And no repeated App name occupies a visible title row
    And each App uses the available card height without clipping its content
    And Pi filters fit a single desktop row above a full-height session list
    And two-hundred-percent zoom removes empty Pi header rows and retains the session scroll area
    And the return handle stays below the App card at compact heights
    And the session detail does not paint beneath its overview
    And background Widgets do not show through the foreground App text
    And Weather emphasizes the actual location and temperature
    And Hydra groups plant readings separately from environment measurements
    And Year progress includes the actual elapsed-year meter
    And WeRead keeps the full excerpt and book metadata together
    And Pomodoro keeps a truthful unavailable state without timer controls
    And Futu labels the daily return and keeps all holding rows reachable

  Scenario: Screenshot review covers every Widget continuation
    Given representative fixture readings in an isolated Shell
    When the gallery opens each Widget in every supported theme
    Then it saves a screenshot and geometry receipt for each App
    And no live providers or hardware capture run

  Scenario: App captures follow the painted document
    Given the screenshot fixture has opened another App
    When the renderer paints a temporary frame marker and removes it
    Then the capture uses the new paint event image
    And no frame marker remains in the captured document

  Scenario: An installed App returns through its owned frame
    Given an active installed App has the Shell bootstrap and a ready owned frame
    When two fingers pinch inward inside that App
    Then the Shell returns to Home through its existing return control
    And Widgets, foreign windows, old tokens, inactive Apps, and modal owners cannot request that return
