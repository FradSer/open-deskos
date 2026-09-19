Feature: Open DeskOS repository architecture

  Scenario: Documentation routes readers to the active runtime or preserved research
    Given the repository separates CM5 runtime, peripherals, experiments, and P4+C6 research
    When a contributor reads tracked product and architecture documentation
    Then it does not direct the contributor to firmware/linux, firmware/open-deskos, app/apple, or docs/open-deskos
    And active CM5 documentation does not present the preserved P4+C6 research line as current product authority

  Scenario: Repository topology contracts run only in a source checkout
    Given a contributor runs repository architecture checks from a Git checkout
    When git-agent classifies a contribution
    Then it uses concise scopes for CM5, hardware, link, vision, S31, P4, and Mac work
    And it does not retain scopes for the removed app or firmware roots
    But a deployed runtime slice does not require preserved research source trees or Git metadata

  Scenario: No test harness activates a window on the desk
    Given the Electron test harnesses in the runtime
    When the repository layout is checked
    Then every harness configures its window without showing or focusing it
    And a harness that would show a window fails the check
