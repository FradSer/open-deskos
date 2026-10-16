Feature: The historical frontend resolves patched serializer and worker dependencies
  Scenario: A malformed serializer buffer cannot allocate an array-like replacement
    Given the actual Solid dependency receives a TypedArray node with an object buffer
    When Seroval deserializes that node
    Then it rejects the malformed source
    And a valid TypedArray still round-trips

  Scenario: A serialized Promise cannot invoke a plugin-produced thenable
    Given an actual Seroval plugin returns an object with a callable then property
    When a fulfilled Promise node references that object
    Then deserialization rejects it without invoking the callable

  Scenario: Inherited worker options cannot redirect execution
    Given a private child process has polluted inherited worker options
    When the actual formatter worker pool starts or receives a task
    Then its configured worker returns the expected result
    And the inherited preload and alternate worker do not execute
