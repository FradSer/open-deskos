Feature: ESP32-P4 SC2336 camera subsystem for Open DeskOS Linux
  As an Open DeskOS companion system running on Orange Pi CM5
  I want an ESP32-P4 sub-device driving a SC2336 MIPI CSI camera
  So that video frames and on-device face recognition metadata are streamed reliably to the Linux host

  Background:
    Given the camera module is an SC2336 1080P CMOS image sensor
    And the sensor is connected to the ESP32-P4 via 2-lane MIPI CSI-2 and SCCB I2C
    And the ESP32-P4 is connected to the CM5 Linux host via USB

  Scenario: SC2336 sensor hardware initialization over MIPI CSI
    When the ESP32-P4 camera firmware boots
    Then the SCCB bus on SDA GPIO 7 and SCL GPIO 8 probes the SC2336 sensor
    And the hardware reset line on GPIO 26 initializes the sensor power state
    And the MIPI CSI-2 video device initializes with 2 data lanes

  Scenario: Video capture format negotiation
    Given the SC2336 camera device is initialized
    When the capture pipeline starts
    Then the driver supports standard formats including 640x480, 1280x720, and 1920x1080
    And frames are captured into DMA-aligned buffers without memory corruption

  Scenario: Streaming video frames to the Linux host over USB
    Given valid video frames are captured from the SC2336 sensor
    When USB is connected to the CM5 Linux host
    Then the ESP32-P4 transmits video frames over USB to the Linux host
    And the transmission recovers gracefully if USB disconnects or restarts

  Scenario: Real on-device face detection and recognition metadata
    Given the SC2336 capture stream is producing RAW8 Bayer frames
    And the ESP32-P4 face inference pipeline converts bounded frame copies to ESP-DL RGB565 input
    And the ESP32-P4 face inference pipeline has loaded its face detection model
    When the inference worker receives a captured frame
    Then it runs real face detection on the ESP32-P4 rather than emitting a fixed face count
    And it emits a monotonic sequence, bounding boxes, landmarks, detection confidence, and measured inference time from the model output
    And it reports an unknown face without claiming an identity or unlock state
    And it never reuses a camera-owned buffer after re-queuing it to V4L2
    And the inference worker yields between queued frames so the P4 watchdog can service the idle task

  Scenario: Physical owner enrollment and recognition
    Given exactly one valid face is visible to the P4 camera
    When the P4 owner-confirmation button is physically pressed
    Then the P4 immediately persists that current face feature and configured owner label in its local storage partition
    And the confirmation request is consumed after that one enrollment attempt
    And subsequent matching detections include the verified owner label, similarity, threshold, and unlocked state
    And a non-matching or ambiguous face remains unknown and unlocked is false

  Scenario: Enrollment fails closed without valid physical confirmation
    Given no physical owner-confirmation button press is active on the P4
    When exactly one face is detected
    Then the P4 does not change the owner feature database
    And the privacy shield remains enabled

  Scenario: Enrollment confirmation fails closed on an invalid or expired observation
    Given the P4 owner-confirmation button is physically pressed
    When zero faces or multiple faces are visible in the next inference result
    Then the P4 cancels the confirmation request without changing the owner feature database
    And a confirmation request that outlives its 30 second window is also cleared without enrollment

  Scenario: Temporary local diagnostic snapshot for hardware alignment
    Given a technician explicitly builds a diagnostic-only P4 firmware image
    When the P4 captures its first camera frame
    Then it emits one downsampled grayscale still to the CM5 serial console
    And the CM5 stores that still only in `/tmp` for inspection
    And the production image does not expose a camera preview or diagnostic snapshot

  Scenario: Structured face recognition metadata protocol for edge inference
    Given face analysis or emotion inference is performed on the ESP32-P4
    When face metadata is generated
    Then the metadata is encoded into a structured v1 JSON record
    And the record contains detected face count, bounding boxes, landmarks, and confidence
    And invalid or corrupt inference results fail closed without false detections
