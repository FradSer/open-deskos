Feature: ESP-IDF Plugin Descriptor Codegen Tool

  Scenario: Generate static C descriptor headers from plugin manifest
    Given a plugin manifest with id odk.s3.driver.st7789
    When the codegen tool runs on the manifest
    Then it generates valid C struct definitions in .rodata
    And the C code contains correct provides and requires port arrays
