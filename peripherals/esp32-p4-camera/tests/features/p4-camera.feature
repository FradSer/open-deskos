Feature: ESP32-P4 SC2336 generic UVC camera subsystem for Open DeskOS Linux
  As an Open DeskOS companion system running on Orange Pi CM5
  I want an ESP32-P4 sub-device driving a SC2336 MIPI CSI camera as a standard USB Video Class device
  So that the CM5 Linux host sees a generic webcam with no on-device face or expression analysis

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
    Then the driver captures 1280x720 frames for the hardware JPEG encoder
    And frames are captured into DMA-aligned buffers without memory corruption

  Scenario: Streaming standard MJPEG video to the Linux host over USB
    Given valid video frames are captured from the SC2336 sensor
    When USB is connected to the CM5 Linux host
    Then the ESP32-P4 enumerates as a standard USB Video Class device
    And the CM5 sees a generic V4L2 video device without vendor-specific drivers
    And the stream carries MJPEG frames at 1280x720
    And the transmission recovers gracefully if USB disconnects or restarts

  Scenario: No on-device face or expression analysis exists
    Given the SC2336 capture stream is producing frames
    When any frame is captured and streamed
    Then the firmware performs no face detection, no owner recognition, and no expression classification
    And no face metadata, landmarks, identity, unlock state, or emotion is encoded or transmitted
    And no biometric feature database is stored on the device

  Scenario: No physical enrollment input exists
    Given the camera firmware is running
    Then no GPIO button press enrolls an owner or changes persistent recognition state
    And no host command can create an identity or unlock result

  Scenario: USB microphone is available to the CM5 as a standard audio input
    Given the OSPTEK ESP32-P4C6 module baseboard V1.3 schematic is the board wiring authority
    And the ES8311 uses I2S0 MCLK GPIO 13, BCLK GPIO 12, LRCK GPIO 10, and ADC output into P4 GPIO 11
    When the ESP32-P4 connects to the CM5 through the native USB data Type-C port
    Then Linux enumerates one composite device with a UVC camera and a USB Audio Class microphone
    And the microphone streams signed 16-bit mono PCM at 16 kHz
    And disconnecting or an unavailable codec never blocks camera capture or the base CM5 shell

  Scenario: Hardware microphone capture proves a live signal without storing speech
    Given the ES8311 microphone device opened successfully
    When the firmware starts its one-shot hardware audio self-test
    Then it reads a bounded PCM window before USB streaming begins
    And it logs only aggregate level statistics
    And it never logs or stores raw microphone samples

  Scenario: CM5 accepts the P4 as live standard audio and video sources
    Given the P4 native USB2.0 data Type-C port is connected to the CM5
    When the CM5 hardware acceptance checks run
    Then they verify the composite USB identity, V4L2 video device, and ALSA capture device
    And they analyze a bounded live MJPEG frame and a bounded live PCM stream without writing media files
    And they reject silence, constant samples, excessive clipping, or a truncated capture
