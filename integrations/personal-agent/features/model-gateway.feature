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
