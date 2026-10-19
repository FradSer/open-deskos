Feature: The voice control channel is a named pipe gated by the shared channel token on a Windows host

  Scenario: A busy Shell does not disconnect during recording level updates
    Given an authenticated Shell has received recording state with current suggestions
    And its status channel temporarily has queued output
    When repeated recording frames change only the audio level
    Or Open DeskOS Data pushes repeat the unchanged current snapshot
    Then those replaceable updates do not grow the queue or disconnect the Shell
    And changed suggestions, transcription state and the final answer are still delivered
    And oversized authoritative frames retain the bounded queue refusal
  Scenario: The voice link resolves to the endpoint the Shell Host already names
    Given a 64-bit Windows Shell Host with an empty local application data directory variable
    When the personal bot service resolves the endpoint of the personal-bot link
    Then the endpoint is the named pipe "\\.\pipe\odk-personal-bot"
    And the Shell client resolves the same endpoint for the same link name
    And a Windows host provisions the voice control channel without a runtime directory

  Scenario: The token file is the one every other Windows runtime channel uses
    Given a Windows host whose local application data directory is C:\Users\fradser\AppData\Local
    When the personal bot service resolves the shared channel token file
    Then the file is C:\Users\fradser\AppData\Local\odk\local-channel.token
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
    And the personal bot service is never asked to toggle
    And no status is published to that peer, because a status is a push and an unproven peer is not on the list
    And a client that writes its handshake and its first command in one frame has that command delivered unchanged
    And the Shell client sees an unavailable personal bot service rather than a half-open channel

  Scenario: A Unix host still authenticates by ownership
    Given a Unix host with an absolute XDG_RUNTIME_DIR
    When the personal bot service resolves the endpoint of the personal-bot link
    Then the endpoint is $XDG_RUNTIME_DIR/odk-personal-bot/agent.sock
    And a client that sends no handshake at all still reaches the protocol with every byte it wrote
    And the control socket is 0600 inside a 0700 directory
    And a control directory that is not owned by this user is refused
    And a socket left behind by a stopped service is taken over, and a live service is refused rather than having its socket stolen
    And a Unix host without an absolute XDG_RUNTIME_DIR cannot place the endpoint, and the service refuses to start rather than inventing a path
    And the reference host behavior, including these refusals, does not change

  Scenario: Handshake limits apply to the handshake rather than the first command
    Given a Windows peer with the shared channel token
    When it sends a valid handshake and a proposal response larger than 512 bytes in one write
    Then the handshake is admitted and the proposal response reaches the service
    And commands beyond the 4096-byte input limit remain refused

  Scenario: Shutdown releases peers still waiting at the handshake
    Given a Unix or Windows listener with a connected peer that has sent no bytes
    When the listener is closed
    Then the peer is disconnected and shutdown completes without waiting for a command
    And the peer never receives a status broadcast

  Scenario: Ownership stays the gate on a Unix host, and the token is a second layer there
    Given a Unix host whose personal bot service is given a channel token
    When a client presents a valid handshake as its first line
    Then the handshake is consumed and the protocol reads the client's own first frame
    And a presented handshake that does not verify is a refusal rather than a fallback to ownership
    And the personal bot service needs no token file of its own when the caller names none

  Scenario: The Shell client is the other end of the same published handshake
    Given the Shell Host client connecting to the voice channel on a Windows host
    When it writes the first line of the connection
    Then it writes the channel handshake frame, the same one the runtime's own channels publish
    And the token it presents is the one in the shared channel token file
    And it may write the handshake and its first command in a single write
    And it sends no handshake where ownership already authenticates the peer, which is every Unix socket endpoint
    And the voice protocol on top of it is unchanged: a status query and a toggle, each one line

  Scenario: Unix channel fixtures have limited platform evidence
    Given the channel tests run on a Unix host
    When they exercise Windows behavior through a stand-in endpoint
    Then they prove the protocol contract without proving native Windows transport behavior
    And native Windows acceptance must exercise real named pipes and profile permissions
    And offline channel tests do not prove live audio capture or provider connectivity

  Scenario: Native Windows acceptance preserves shared agent behavior
    Given an isolated Windows profile and private authenticated channels
    When the agent reads Open DeskOS Data and controls installed applications
    Then its public tool results match the Unix host behavior
    And invalid frames remain rejected
    And proactive confirmation completes without microphone capture

  Scenario: Windows starts only the central display role
    Given an isolated Windows profile without provider credentials or a configured microphone
    When the actual display entry connects to a private simulated CM5 channel
    Then authenticated text input reaches that channel and its reply returns
    And startup does not load inference or transcription modules or start recording
    And the resident entry refuses Windows before migration or channel creation
    And resident startup checks report an explicit Windows role skip
    And extracted configuration checks still run on each host

  Scenario: The central display modules load from a flattened release
    Given the current Personal Bot sources and Shell modules in the release layout
    And the release has no repository runtime/shell directory
    When the actual display client and relay modules are imported
    Then both use the installed Shell platform and channel modules
    And no resident agent, microphone capture or network connection starts

  Scenario: The forced bridge starts through the active release symlink
    Given the CM5 forced command names the current release symlink
    When the actual bridge entry starts with SSH input still open
    Then it connects only to the resident owner's fixed socket
    And a read-only status request and response pass through the bridge
    And it also starts when Node preserves the main symlink
    And importing the bridge does not start a connection
