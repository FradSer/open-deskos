Feature: Open DeskOS repository architecture

  Scenario: One host-neutral Shell owns the shared runtime
    Given Linux, Windows, and macOS run the same Electron Shell
    When a contributor locates the runtime in a source checkout
    Then the runtime lives at runtime/shell rather than a host-specific directory
    And repository-root discovery resolves that checkout from nested runtime tools
    And the existing Electron profile identity survives the directory rename

  Scenario: macOS is a Shell Host without invented runtime endpoints
    Given macOS runs the shared Shell on x64 or arm64
    When the platform layer resolves that host without a runtime directory
    Then it reports a supported non-reference Shell Host
    And it retains the existing Unix state location
    And unconfigured runtime channels remain absent

  Scenario: Documentation routes readers to the active runtime or preserved research
    Given the repository separates CM5 runtime, peripherals, experiments, and P4+C6 research
    When a contributor reads tracked product and architecture documentation
    Then it does not direct the contributor to firmware/linux, firmware/open-deskos, app/apple, or docs/open-deskos
    And active CM5 documentation does not present the preserved P4+C6 research line as current product authority

  Scenario: Repository topology contracts run only in a source checkout
    Given a contributor runs repository architecture checks from a Git checkout
    When git-agent classifies a contribution
    Then it uses concise scopes for Shell, hardware, link, vision, P4, Mac, tooling, and experiments
    And a research scope covers contributions spanning preserved research components
    And it does not retain scopes for the removed app or firmware roots
    But a deployed runtime slice does not require preserved research source trees or Git metadata

  Scenario: No test harness activates a window on the desk
    Given the Electron test harnesses in the runtime
    When the repository layout is checked
    Then every harness configures its window without showing or focusing it
    And a harness that would show a window fails the check
