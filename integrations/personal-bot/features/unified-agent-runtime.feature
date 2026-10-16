Feature: One Personal Agent capability and admission architecture
  Scenario: An external turn must pass Jev before runtime recovery or turn state
    Given an external request and a suspended resident session
    When Jev fails or asks for clarification
    Then no session recovery, memory context or task execution starts
    And the previous turn authority is cleared

  Scenario: A declaration supplies the complete reviewed capability
    Given a personal profile declares the reviewed browser capability
    When the resident starts and Jev selects browsing
    Then the browser tools and its bundled Skill are registered together
    And an absent declaration supplies neither

  Scenario: Host admission supplies child authority
    Given the parent has admitted a child through its gated task tools
    When the child starts with its own private state directory
    Then the child uses a fixed execution workflow without a second Jev client
    And only descriptor-approved capabilities pass to the child
