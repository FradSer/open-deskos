Feature: Package appearance context

  Scenario: A package receives the appearance it is rendering under
    Given the Shell has an active theme
    When it mounts an installed package
    Then the frame carries that theme on its URL
    And the served document sets data-theme to it
    And the package reads the appearance from a data-theme attribute instead of
      guessing from its surroundings

  Scenario: The context carries every appearance at once
    Given a package document served by the Shell
    When it is inspected
    Then every theme's tokens are present, so a switch needs no reload
    And the tokens name the same roles the built-in surfaces use
    And the values match the built-in stylesheets they mirror

  Scenario: A package renders in the Shell's own faces
    Given the Pixel appearance is active
    When a package asks for the appearance font
    Then the document declares the Zpix face served from the running release
    And no other file in the release can be requested through that route
    And the Instrument and Border Beam appearances declare Montserrat and Noto Sans SC

  Scenario: A theme change reaches a live frame
    Given an installed package is mounted
    When the Shell switches theme
    Then the frame is told the new theme
    And the package's appearance attribute follows without a reload

  Scenario: The appearance context grants no new authority
    Given a package using the context
    When it runs
    Then it still has no network, no Shell DOM, and no preload API
    And it can load only the fonts the appearance declares
    And its readiness handshake still authenticates on its own token

  Scenario: The context cannot drift from the built-in stylesheets
    Given the appearance tokens and the rendered Shell tokens
    When both are read for the same theme
    Then every shared role resolves to the same value in the package and in the Shell

  Scenario: A package that uses the context verifies like any other
    Given a candidate package whose styles read the appearance tokens and faces
    When the system verifier renders it
    Then it loads with the base appearance's context
    And it becomes visible without reaching the network