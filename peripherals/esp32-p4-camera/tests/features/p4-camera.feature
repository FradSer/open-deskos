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

  Scenario: UAC cleanup follows USB callback shutdown
    Given the composite USB driver has stopped its callbacks
    When the UAC lifecycle adapter stops
    Then microphone and speaker tasks exit through their own loops
    And the adapter releases their shared state after both exits

  Scenario: An audio task has not finished
    Given an audio task is completing a callback
    When the shutdown deadline expires
    Then the adapter retains shared state for cleanup retry
    And it does not force-delete the task

  Scenario: An unsupported UAC source revision is supplied
    Given a dependency source that the adapter has not reviewed
    When the firmware configures
    Then extension generation fails before it writes a source file

  Scenario: UAC restarts before the previous exit signal returns
    Given a worker exit has awakened the serialized lifecycle owner
    And the worker can still hold the event group lock
    When the owner initializes and stops the next UAC instance
    Then the adapter reuses the initialized event group
    And it clears previous exit bits through the event group API

  Scenario: A capture task has not finished during plugin shutdown
    Given the UVC capture task is completing a driver operation
    When the shutdown deadline expires
    Then shutdown reports a timeout without deleting the task
    And capture and encoder resources remain owned
    And initialization cannot replace the retained instance

  Scenario: UVC resource cleanup fails
    Given the capture task has exited
    When a stream or buffer cleanup operation fails
    Then cleanup reports the failure
    And it retains the resources needed for a cleanup retry

  Scenario: A video descriptor close fails
    Given the capture task has exited
    When closing a video descriptor fails
    Then the instance reports incomplete cleanup
    And it does not reuse that descriptor or start a replacement instance

  Scenario: A stopped video stream restarts
    Given the driver cleared its capture and JPEG queues during stop
    When the lifecycle owner starts the initialized stream again
    Then capture and JPEG buffers are queued before their streams start
    And a queue retry does not enqueue an already queued buffer again

  Scenario: Plugin shutdown cancels an empty video receive wait
    Given the capture stream has no completed frame
    And the lifecycle owner bound its running flag to the video receiver
    When the owner stops the plugin
    Then the pending receive observes cancellation without deleting the capture task
    And cleanup waits for task exit before it stops streams or closes descriptors

  Scenario: A receiver has no lifecycle binding
    Given a video receiver has no plugin cancellation flag
    When it receives a frame
    Then it uses the original driver wait behavior

  Scenario: A video receiver is replaced
    Given its old worker has exited
    When cleanup closes the old video descriptor
    Then cleanup removes its cancellation binding first
    And a new receiver cannot retain the old lifecycle flag

  Scenario: Native plugins boot the default camera and microphone
    Given the default storage, I2C, sensor, USB, microphone, and stream plugins are enabled
    When the native plugin host starts
    Then it retains the existing hardware initialization order
    And video uses the published camera devices and USB video sink
    And audio uses the published I2C bus and USB audio transport

  Scenario: A replacement USB transport is supplied
    Given a transport publishes the required video sink and audio binding ports
    When the microphone and video plugins start
    Then their callbacks use that transport's functions and context
    And they do not call the default transport through hidden globals

  Scenario: Microphone cleanup waits for callbacks
    Given the USB microphone callback is reading the codec
    When the microphone plugin stops
    Then it removes its USB binding after the callback completes
    And it frees codec resources only after capture has stopped

  Scenario: A codec resource release fails
    Given capture has stopped and USB callbacks no longer use the source
    When microphone cleanup cannot release a resource
    Then it retains retryable resources or reports unresolved SDK cleanup
    And its I2C and USB providers remain owned

  Scenario: UAC initialization failed before its worker started
    Given the UAC singleton exists after an unsuccessful initialization
    When the microphone plugin retries its audio binding
    Then the transport returns the original failure
    And successful USB and UAC cleanup is required before a new binding

  Scenario: CSI registration fails after sensor detection
    Given the driver has detected and allocated the sensor
    When CSI device registration fails
    Then cleanup retains the sensor pointer until sensor deletion succeeds
    And it releases SCCB only after sensor cleanup

  Scenario: USB worker shutdown waits for its callback
    Given the USB worker is processing a device event
    When its lifecycle owner stops the USB plugin
    Then the worker finishes that event and signals its own exit
    And stack cleanup starts only after that signal
    And a timeout retains the worker context and descriptors

  Scenario: USB stack cleanup needs another attempt
    Given the USB worker has exited
    When stack teardown fails
    Then the lifecycle owner retains the context and descriptors
    And the next cleanup attempt retries stack teardown without deleting the worker

  Scenario: USB PHY cleanup needs another attempt
    Given stack cleanup succeeded
    When PHY release fails
    Then the driver retains its PHY handle
    And the next cleanup attempt skips completed task cleanup and retries PHY release

  Scenario: A USB initializer has not completed
    Given the USB worker is still initializing when its startup deadline expires
    When cleanup also reaches its deadline
    Then initialization returns its failure without freeing the live worker context
    And the driver retains its PHY until that worker exits

  Scenario: A delayed USB initializer outlives its caller configuration
    Given the driver copied the descriptor configuration before starting its worker
    When startup times out and the caller configuration no longer exists
    Then the delayed worker uses its owned configuration copy
    And the static descriptor data remains valid until cleanup completes

  Scenario: Stack initialization fails before the SDK records its state
    Given stack initialization allocated resources before its initialized flag became valid
    When initialization fails and cleanup cannot discover those resources
    Then the driver retains its unresolved ownership and reports incomplete cleanup
    And replacement cannot initialize over that state
