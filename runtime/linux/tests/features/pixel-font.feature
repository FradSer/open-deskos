Feature: Local bilingual Zpix typography in the Pixel theme

  Scenario: Pixel uses the original upstream font without a remote runtime dependency
    Given the official Zpix v3.2.0 WOFF2 is packaged with its source and license notice
    When the Pixel theme loads
    Then it loads the unchanged local WOFF2 under the existing local-only Content Security Policy
    And the retired Silkscreen faces and files are no longer used
    And Zpix is declared at its real Regular weight without synthetic bold or italic

  Scenario: Chinese English and digits render with Zpix
    Given the shell is using the Pixel theme
    When widgets, App content, status text, inputs, placeholders, and code values render
    Then their first font family is Zpix
    And representative English, simplified Chinese, traditional Chinese, and digits actually use the loaded custom Zpix font
    And the renderer UI keeps its existing English copy while user-provided Chinese text is supported

  Scenario: Theme switching restores the original typography
    Given the current page and a focused control are selected
    When the theme changes from Pixel to Instrument or Border Beam
    Then their existing Noto Sans SC and Montserrat typography is restored
    And no page navigation or control remount occurs
    When the theme changes back to Pixel
    Then English and Chinese return to Zpix without losing focus or changing page

  Scenario: Pixel font does not break established layouts
    Given Pixel is rendered at desktop, compact, or 200 percent zoom sizes
    Then primary Widget signals and App controls remain inside their surfaces
    And Pixel-specific type sizing maintains the shared 54 to 70 percent visual density band
    And year-start, year-end, live, and unavailable fixture states are checked
    And both State Bar capsules retain equal 44 pixel heights
    And the text-free page indicator keeps its themed points and active bar
    And the standard Electron E2E command runs both font and page-control verification
