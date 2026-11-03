Feature: One Open deskOS model gateway

  Scenario: Every chat model in open-deskos and CM5 uses the same gateway
    Given the operator supplies the gateway key through an approved secret store
    When the Open deskOS model configuration is applied to a Pi agent directory
    Then the only configured provider is "open-deskos"
    And the only model is "hunyuan-eval/hy4-dev"
    And requests go to "http://10.10.0.195:3425/v1/chat/completions"
    And the request identifies its client as "Open deskOS"
    And the configuration file contains no literal credential
