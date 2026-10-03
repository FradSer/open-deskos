Feature: ESP-IDF Plugin Descriptor Codegen Tool

  Scenario: Generate static C descriptor headers from plugin manifest
    Given a plugin manifest with id odk.s3.driver.st7789
    When the codegen tool runs on the manifest
    And its working directory is outside the repository
    Then it generates valid C struct definitions in .rodata
    And the C code contains correct provides and requires port arrays

  Scenario: Preserve manifest text in valid C strings
    Given a manifest name containing quotes, backslashes, question marks, and control characters
    When the descriptor is generated and compiled by the host C compiler
    Then the descriptor contains the exact manifest name
