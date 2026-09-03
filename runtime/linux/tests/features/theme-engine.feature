Feature: Dynamic Theme Token Engine & Built-in Pixel Art Theme

  Scenario: Theme plugin registers and applies custom token dictionary
    Given a theme plugin "odk.theme.pixel-art" with kind "theme"
    When the theme is activated by the theme engine
    Then the root document style properties update with the pixel theme tokens
    And elements receive 0px radii, stepped borders, and retro colors

  Scenario: Switching themes is instant and reversible
    Given the display is currently rendering the default theme
    When the user switches to the Pixel Art theme
    Then the active theme updates instantly without full page reload
    When the user switches back to the default theme
    Then the original semantic tokens are restored
