Feature: Open DeskOS repository architecture

  Scenario: Documentation routes readers to the active runtime or preserved research
    Given the repository separates CM5 runtime, peripherals, experiments, and P4+C6 research
    When a contributor reads tracked product and architecture documentation
    Then it does not direct the contributor to firmware/linux, firmware/open-deskos, app/apple, or docs/open-deskos
    And active CM5 documentation does not present the preserved P4+C6 research line as current product authority
