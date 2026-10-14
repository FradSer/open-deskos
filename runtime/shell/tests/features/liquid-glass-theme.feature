Feature: Optional Liquid Glass theme

  Scenario: Select and restore Liquid Glass without changing Shell behavior
    Given the Shell uses its default Pixel theme
    When Liquid Glass is selected through the theme API
    Then Liquid Glass is saved and restored after restart
    And page content, geometry, focus, and direct input remain unchanged
    And the status bar has no theme switcher

  Scenario: Keep Liquid Glass readable when WebGPU is unavailable
    Given Liquid Glass is selected
    And the host has no usable WebGPU adapter
    When the appearance is initialized
    Then the local static glass style remains readable
    And theme switching and keyboard input remain available

  Scenario: Keep widget content clear above refractive glass surfaces
    Given the home desk contains text and data inside Liquid Glass surfaces
    When the SDK prepares its glass material maps
    Then the SDK uses a separate ambient layer as its refracted content
    And widget text and icons remain outside that filtered layer
    And the glass surfaces refract the ambient layer without blurring their content

  Scenario: Keep the narrow home desk scrollable while the glass scene is active
    Given the home desk is 320 pixels wide and its content exceeds the viewport height
    And the Liquid Glass scene is active
    When the operator scrolls the home desk
    Then the vertical scroll position reaches the end of the content

  Scenario: Release Liquid Glass resources after switching themes
    Given Liquid Glass has an active glass scene
    When the operator selects Pixel or Instrument
    Then the scene and registered surfaces are disposed
    And the selected theme renders without glass filters
