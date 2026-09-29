Feature: The voice control channel is a named pipe gated by the shared channel token on a Windows host
  Scenario: The voice link resolves to the endpoint the Shell Host already names
    Given a 64-bit Windows Shell Host with an empty local application data directory variable
    When the voice service resolves the endpoint of the voice-agent link
    Then the endpoint is the named pipe "\\.\pipe\open-deskos-voice-agent"
    And the Shell client resolves the same endpoint for the same link name
    And a Windows host provisions the voice control channel without a runtime directory

  Scenario: The token file is the one every other Windows runtime channel uses
    Given a Windows host whose local application data directory is C:\Users\fradser\AppData\Local
    When the voice service resolves the shared channel token file
    Then the file is C:\Users\fradser\AppData\Local\open-deskos\local-channel.token
    And the Shell Host resolves the same file for its own channels
    And the file is created on first use with 32 random bytes, base64url, a trailing newline and mode 0600
    And a host without mode bits still creates it, because a failed mode change is not a failed channel
    And two services starting at the same instant on a cold host end up with one token, not two
    And the loser's own random candidate is discarded rather than left in the file

  Scenario: The token is the gate where ownership cannot reach
    Given a Windows host whose voice control channel is a named pipe
    When a peer connects and presents {"v":1,"token":"the shared channel token"}
    Then the token is compared in constant time with the length checked first
    And a token of a different value or a different length is a refusal
    And a first line that is not a handshake, a handshake of another version, a token that is not a string, and a handshake beyond 512 bytes are each a refusal
    And the listener stays available after every refusal

  Scenario: A peer without the token never reaches the voice protocol
    Given a Windows host whose voice control channel is a named pipe
    When a peer connects without a valid handshake, writes a toggle in the same frame, and waits
    Then the connection is destroyed before any command is parsed
    And the voice service is never asked to toggle
    And no status is published to that peer, because a status is a push and an unproven peer is not on the list
    And a client that writes its handshake and its first command in one frame has that command delivered unchanged
    And the Shell client sees an unavailable voice service rather than a half-open channel

  Scenario: A Unix host still authenticates by ownership
    Given a Unix host with an absolute XDG_RUNTIME_DIR
    When the voice service resolves the endpoint of the voice-agent link
    Then the endpoint is $XDG_RUNTIME_DIR/open-deskos-voice/agent.sock
    And a client that sends no handshake at all still reaches the protocol with every byte it wrote
    And the control socket is 0600 inside a 0700 directory
    And a control directory that is not owned by this user is refused
    And a socket left behind by a stopped service is taken over, and a live service is refused rather than having its socket stolen
    And a Unix host without an absolute XDG_RUNTIME_DIR cannot place the endpoint, and the service refuses to start rather than inventing a path
    And the reference host behavior, including these refusals, does not change

  Scenario: Ownership stays the gate on a Unix host, and the token is a second layer there
    Given a Unix host whose voice service is given a channel token
    When a client presents a valid handshake as its first line
    Then the handshake is consumed and the protocol reads the client's own first frame
    And a presented handshake that does not verify is a refusal rather than a fallback to ownership
    And the voice service needs no token file of its own when the caller names none

  Scenario: The Shell client is the other end of the same published handshake
    Given the Shell Host client connecting to the voice channel on a Windows host
    When it writes the first line of the connection
    Then it writes the channel handshake frame, the same one the runtime's own channels publish
    And the token it presents is the one in the shared channel token file
    And it may write the handshake and its first command in a single write
    And it sends no handshake where ownership already authenticates the peer, which is every Unix socket endpoint
    And the voice protocol on top of it is unchanged: a status query and a toggle, each one line

  Scenario: What these tests do not prove
    Given a named pipe only exists on a Windows host
    And the automated tests for this channel run the handshake gate over a stand-in endpoint on a Unix host
    Then no test creates a real Windows named pipe, and none runs on a Windows host here
    And a test proves the pipe name is handed to the transport unchanged, not that Windows accepts it
    And the token file's Windows location is asserted through the calls the listener makes, not by a Windows profile ACL
    And a peer that is refused is observed to be destroyed; the wording a Windows client surfaces is not asserted
    And no test captures audio, starts a transcription provider, or reaches the network
