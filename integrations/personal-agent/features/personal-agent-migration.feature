Feature: Personal Agent replaces the Audio Agent product
  Scenario: Preserve device history during the naming migration
    Given private state from a previous Audio Agent installation
    When Personal Agent starts for the first time
    Then the same checkpoint and proposal history move to the Personal Agent state directory
    And an existing destination is never overwritten

  Scenario: Existing device configuration keeps working
    Given a legacy device environment and a new Personal Agent setting
    When configuration is normalized
    Then legacy settings fill only absent Personal Agent settings
    And explicit Personal Agent settings take precedence

  Scenario: Both Shell Hosts use the Personal Agent channel
    Given a supported Windows or Linux Shell Host
    When the Shell connects to its resident bot
    Then it uses the Personal Agent endpoint and Personal Agent interface names

  Scenario: A later authorized upgrade retires the previous service name
    Given an existing Personal Agent runs under the previous service name
    When an operator activates the renamed service through the deployment workflow
    Then the workflow stops the previous service before history migration
    And it retains the previous service declaration and history for recovery
    And editing these scripts does not deploy or activate a service
