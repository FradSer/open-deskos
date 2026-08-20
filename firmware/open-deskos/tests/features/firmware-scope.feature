Feature: Open DeskOS firmware scope
  The repository exposes one product firmware for the Guition JC4880P443C board.

  Scenario: The product firmware has a product-specific application identity
    Given the Open DeskOS firmware source tree
    When the production application is selected for an ESP-IDF build
    Then its application path is application/open_deskos
    And its ESP-IDF project identity is open_deskos
    And the legacy upstream application path is absent

  Scenario: Only the Guition production board remains
    Given the Open DeskOS production firmware application
    When board-manager definitions are enumerated
    Then exactly one board definition is available
    And that board is guition/jc4880p443c with board ID jc4880p443c
    And no upstream sample firmware application remains
