Feature: Windows microphone capture without ALSA
  Background:
    Given a 64-bit Windows Shell Host where arecord and ALSA do not exist
    And ffmpeg is a device dependency the operator provisions separately

  Scenario: The Windows host captures through ffmpeg DirectShow
    Given the operator configured the DirectShow device name "Microphone (2- USB Audio Device)"
    When the voice recorder starts a capture on that host
    Then ffmpeg reads DirectShow audio input and writes raw signed 16-bit little-endian 16 kHz mono to standard output
    And the operator device name is passed through verbatim without parsing or quoting
    And standard input is a pipe and no arecord process is started
    And the Linux host still captures through arecord with an ignored standard input

  Scenario: Windows capture shares the framing, level and endpointing contract
    Given Windows capture streams microphone PCM from ffmpeg standard output
    When the local WebRTC VAD detects speech followed by 60 consecutive silent 20 ms frames
    Then capture endpoints once after approximately 1.2 seconds of silence
    And silence before speech never submits
    And the streamed WAV header describes the final 16 kHz mono audio without buffering the recording
    And recording status publishes a measured RMS level every five 20 ms frames
    And a manual MIC toggle still stops capture

  Scenario: Stopping Windows capture flushes the buffered tail
    Given a Windows capture is streaming microphone audio
    When capture stops by endpointing, by a MIC toggle or by shutdown
    Then the ffmpeg quit command is written to standard input so buffered audio is flushed before exit
    And the capture process is terminated only when it has not exited within the two second grace period
    And an ffmpeg that exits non-zero after the requested quit is a successful capture stop
    And an unexpected crash before the stop fails the capture as "Recording failed"

  Scenario: A Windows host without ffmpeg reports an unavailable microphone
    Given ffmpeg is not provisioned on the Windows host
    When the voice recorder starts a capture
    Then the capture is rejected as "Microphone unavailable"
    And the VAD allocation and the temporary capture directory are released once
    And no empty or invented audio file is submitted as if it were a capture

  Scenario: Automatic coverage is not Windows hardware acceptance
    Given the Windows capture contract is covered by tests that replace the capture process
    Then the tests assert the exact command, standard input, framing, levels, endpointing and cleanup
    And the tests never open a microphone, decode DirectShow audio or contact a network
    And hardware acceptance remains a separate gate on a real Windows host with a provisioned ffmpeg and the operator's device name
