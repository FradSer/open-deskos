Feature: Dashboard narrative layout
  The Dashboard is the initial home page and must preserve the intended sentence
  rhythm on the 480px P4 panel without clipping pills, prose, or punctuation.

  Scenario: Dashboard is shown at startup
    Given the Shell has started on the home pager
    Then home page 1 is selected
    And the Dashboard is visible without a swipe

  Scenario: Default daily plan is naturally left aligned
    Given the Dashboard is rendered on a 480px-wide panel
    When its default placeholder daily plan is displayed
    Then every narrative row fits within the available page width
    And every narrative row begins at the Dashboard's left edge
    And no narrative row distributes residual width between sentence fragments
    And the first row keeps "You have 99 events," together
    And "99 tasks" is followed by one measured word space before "and"
    And the conjunction remains with the preceding "99 tasks" phrase
    And "99 habits" shares its row with "today. You're" when their measured widths fit
    And every remaining phrase follows the preceding phrase until the next declared semantic boundary overflows
    And "after 4 pm." and "99 focus" remain in reading order
    And events, tasks, and habit are explicit placeholders
    And focus remains an interactive Pomodoro entry
    And events and habits retain their measured inline icons
    And every inline icon is centered within its measured icon slot
    And white inline metric labels share the surrounding prose baseline
    And the host layout harness verifies that baseline from actual LVGL label positions
    And inline icons use the approved downward optical offset
    And no later row begins with punctuation

  Scenario: Dashboard uses the shell black background
    Given the Dashboard page is visible
    When its background is rendered behind the narrative content
    Then it uses the AIODI black background token
    And it does not introduce a gray page surface

  Scenario: Dashboard prioritizes a reference-style daily narrative
    Given the Dashboard is rendered on a 480px-wide panel
    When daily plan placeholders and focus are visible
    Then the narrative uses the measured 39px display scale without clipping
    And muted connective prose frames white inline metrics
    And sentence fragments retain their natural spacing after punctuation
    And the redundant lower summary capsule is absent

  Scenario: Inline placeholders use measured text and icon geometry
    Given the Dashboard is rendered on a 480px-wide panel
    When the focus fixture is "99 focus"
    Then each inline metric width is derived from its measured label
    And each icon glyph bitmap is centered from its measured bounds within its fixed icon slot
    And every glyph bitmap fits within its icon slot
    And every glyph bitmap is vertically centered within its text line
    And every white inline metric label is positioned from the shared text baseline
    And the host layout harness fails if rendered prose and metric baselines drift
    And every narrative row still fits the available page width

  Scenario: Daily-plan typography never mixes sizes
    Given the Dashboard is rendered on a 480px-wide panel
    When the daily-plan fixture is "99 events,", "99 tasks", and "99 habits"
    Then every narrative row uses the same preferred type scale
    And the 99-count fixture has no content outside the Dashboard container
    And an overflowing sentence reflows only at its declared semantic boundaries
    And every adjacent narrative fragment is separated by one measured word space
    And no row template forces a break while the next semantic fragment still fits

  Scenario: Extreme daily-plan text preserves the shared type scale
    Given the Dashboard is rendered on a 480px-wide panel
    When a row exceeds the available width at the shared type scale
    Then the planner splits it only at its declared semantic boundaries
    And every reflowed row remains inside the Dashboard container
    And any single unbreakable value is visibly abbreviated rather than clipped
    And no row reduces its type scale
