Feature: Personal Bot replaces the Audio Agent product
  Scenario: Preserve device history during the naming migration
    Given private state from a previous Audio Agent installation
    When Personal Bot starts for the first time
    Then the same checkpoint and proposal history move to the Personal Bot state directory
    And an existing destination is never overwritten

  Scenario: Existing device configuration keeps working
    Given a legacy device environment and a new Personal Bot setting
    When configuration is normalized
    Then legacy settings fill only absent Personal Bot settings
    And explicit Personal Bot settings take precedence

  Scenario: Both Shell Hosts use the Personal Bot channel
    Given a supported Windows or Linux Shell Host
    When the Shell connects to its resident bot
    Then it uses the Personal Bot endpoint and Personal Bot interface names
