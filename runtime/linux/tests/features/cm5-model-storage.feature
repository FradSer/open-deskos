Feature: CM5 model payload storage on the SSD

  The CM5 keeps executable code and Python environments on the ext4 root filesystem,
  while large immutable model payloads live on the mounted SSD and remain available
  through their existing /opt paths.

  Scenario: Large model payloads migrate without changing application paths
    Given the SSD is mounted at /mnt/ssd
    And rkllama and Qwen ASR model payloads are stored on the root filesystem
    When the model storage migration runs
    Then rkllama models are stored below /mnt/ssd/open-deskos/models
    And Qwen ASR RKNN models are stored below /mnt/ssd/open-deskos/models
    And /opt/rkllama/models remains the runtime path
    And /opt/qwen3-asr-1.7b/rknn remains the runtime path

  Scenario: Model mounts survive a reboot
    Given both model payloads were copied and verified on the SSD
    When the migration activates the new storage
    Then /etc/fstab contains idempotent bind mounts for both runtime paths
    And both bind mounts depend on /mnt/ssd
    And a missing SSD does not prevent the CM5 from booting

  Scenario: Migration never destroys the only model copy
    Given a model payload is being migrated
    When the SSD copy does not match the root filesystem copy
    Then the migration stops before deleting root filesystem data
    And the original model payload remains available

  Scenario: Interrupted migration resumes from the verified SSD payload
    Given the SSD payload was verified and activated but the root backup was not deleted
    When the migration runs again
    Then it recognizes the intended SSD bind mount
    And it deletes the obsolete root backup after confirming the intended mount
    And it never treats the empty runtime mountpoint as the source of truth
    And it completes the persistent mount configuration without deleting the SSD payload

  Scenario: A lookalike bind from another device is rejected
    Given the runtime path is mounted from a different device with the same filesystem-root text
    When the migration checks the active bind
    Then it rejects the mount as unexpected
    And it does not delete or replace either model copy

  Scenario: Model payloads are read-only to applications
    Given the SSD uses exFAT and cannot preserve Unix ownership or modes
    When the SSD and model bind mounts activate
    Then the SSD mount masks write access from non-root users
    And both model bind mounts are remounted read-only
    And model files remain readable by Open DeskOS services

  Scenario: An exFAT SSD does not host executable environments
    Given /mnt/ssd uses exFAT
    When storage scope is selected
    Then only immutable model payload directories move to the SSD
    And application code, Python environments, and executable entry points remain on ext4
