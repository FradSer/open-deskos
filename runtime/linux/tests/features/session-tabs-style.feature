Feature: Consistent session tab controls
  Scenario Outline: Calm, legible controls across themes and widths
    Given the Pi Sessions page in <theme> at <width> pixels wide
    When a session filter is selected and Overview is opened
    Then filters sit in the page title row, on its trailing edge
    And filters have an inset segmented track and a persistent selected outline
    And all controls retain at least 44 by 44 pixel targets without overlap
    And Overview has a visible expanded state and keyboard focus outline
    And controls have no shadow or spatial press animation
    And labels remain readable and contained

    Examples:
      | theme       | width |
      | instrument  | 1920  |
      | border-beam | 480   |
      | pixel       | 320   |
