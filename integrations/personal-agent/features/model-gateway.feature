Feature: One Open deskOS model gateway

  Scenario: Every chat model in open-deskos and CM5 uses the same gateway
    Given the operator supplies the gateway key through an approved secret store
    When the Open deskOS model configuration is applied to a Pi agent directory
    Then the only configured provider and provider name are "magpie"
    And the only model is "hunyuan-eval/hy4-dev"
    And requests go to "http://10.10.0.195:3425/v1/chat/completions"
    And the request identifies its client as "Open deskOS"
    And the client name escapes its space so magpie does not cut it to "Open"
    And the provider name and the client name stay independent
    And the configuration file contains no literal credential
    And every client of the project reads the same client name from ODK_MODEL_CLIENT_NAME

  Scenario: The client name does not depend on a configured models.json
    Given a fresh installation has no gateway headers in its Pi agent directory
    When any Open DeskOS model runtime sends a request
    Then the request carries the Open deskOS client name

  Scenario: Model requests mask recognized private text on the device
    Given an owner turn, a tool result, and a classifier state contain private values
    When Pi sends the requests to the configured models
    Then the model receives placeholders for email addresses, labeled phone numbers, and recognized secrets
    And a repeated value has the same placeholder within one request
    And the provider authentication and local conversation are unchanged
    And a masking failure stops the request before provider dispatch

  Scenario: Streamed placeholders are restored only on the device
    Given a model returns a placeholder across several text or tool argument chunks
    When Pi delivers the response to the local caller
    Then the caller sees the original value without a partial placeholder
    And an unknown placeholder remains unchanged
