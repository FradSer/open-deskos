Feature: Android Shell Host renders the shared Personal Agent

  The Android host shows the renderer every other Shell Host shows. The desk
  generates every briefing and reply, so the phone only carries them.

  Scenario: The host loads the shared renderer
    Given the Android app packages a staged renderer asset set
    When the WebView loads the Shell document
    Then the loaded document is the shared renderer
    And no renderer file under Android differs from the shared source

  Scenario: The phone reads the desk over an outbound link
    Given the phone holds a provisioned report token
    When the host opens its link to the desk
    Then the desk authenticates that token
    And the desk reports the phone as one connected client
    And the phone never joins the machine session snapshot
    And the desk opens no new inbound port

  Scenario: Generated content arrives from the desk
    Given the desk produced a briefing and a reply
    When the desk publishes the Personal Agent frame
    Then the phone shows that briefing and that reply
    And the phone generated no content of its own

  Scenario: A dropped link reports itself
    Given the link is open and the phone shows a conversation
    When the link drops
    Then the Agent capsule states the unavailable condition
    And the conversation keeps the content the desk already sent
    And the composer keeps the owner draft

  Scenario: The owner submits a text turn
    Given the phone holds the control credential for the desk
    When the owner sends a text turn
    Then the desk resident receives that turn once
    And the reply arrives over the same link
    And the phone reports the delivery outcome it received

  Scenario: A read grant cannot submit
    Given the phone holds only the report credential
    When the owner sends a text turn
    Then the phone refuses the turn without presenting it
    And the phone states that delivery was not confirmed
    And the conversation shows no generated reply
    And a turn presented without a valid proof is refused by the desk

  Scenario: The desk development source shows each design state
    Given the desk runs its development frame source
    When the operator selects a Personal Agent state
    Then the desk publishes that state
    And the phone renders that state
    And the host marks the state as development
    And no Android build carries that content

  Scenario: Voice states render from the status frame
    Given the desk publishes recording, transcribing and thinking frames
    When the status panel renders
    Then each state shows its own caption and control availability
    And validated voice failure codes survive both frame projections independently of owner wording
    And unknown codes and codes outside error states are dropped
    And a microphone action on this host starts no recording, because it captures no audio

  Scenario: A narrow phone uses the compact rules
    Given the desk is 360 by 640 density-independent pixels
    When the Personal Agent page renders
    Then the composer stays inside the pane
    And the conversation keeps a usable scroll area
    And no checked element overflows the viewport

  Scenario: Android and Electron agree per state
    Given one desk development frame and the shared parity assertion script
    When the Android WebView and Electron render that frame at the same viewport
    Then geometry, copy and visibility agree within the recorded tolerance
    And each host retains its capability and request-state control boundaries
    And busy or unavailable requests cannot enable text submission
    And recording replaces text controls with Cancel and Send only on a voice-capable host
    And a text-only host keeps its editable keyboard and disables Send during recording
    And the run stores one screenshot per state

  Scenario: An engine below the baseline cannot pass as acceptance
    Given the compared WebView reports its own version
    When that version predates the renderer's engine baseline
    Then the acceptance run fails
    And the recorded engines name what actually rendered

  Scenario: Unreachable providers state their real condition
    Given the phone holds no Open DeskOS Data and no installed package store
    When the Shell composes its pages and widgets
    Then each provider reports its actual unavailable state
    And Shell composition completes
    And the host invents no message and no notification

  Scenario: The Agent identity survives a restart
    Given the owner saved an Agent name and icon on the device
    When the app starts again
    Then the conversation, composer and heading use that identity

  Scenario: The renderer keeps its content security policy
    Given the host serves renderer assets from its asset-loader origin
    When the document loads
    Then every script, style, font and image loads from that origin
    And the app adds no script source

  Scenario: Both ends agree on the frame contract
    Given the shared Personal Agent frame fixtures
    When the desk and the Android client encode and decode each fixture
    Then both ends produce the same fields and the same bounds
    And an unknown frame version is refused rather than guessed

  Scenario: Android acceptance stays separate
    Given only Android checks ran
    When the acceptance record is written
    Then it names the tested Android device and WebView version
    And other Shell Host acceptance stays separate
  Scenario: A phone keeps the central conversation and the exact reply reference
    Given CM5 owns a conversation with a bound reply and an owner turn identifier
    When the Android host receives the public frame and submits a reply
    Then the public conversation and owner identity stay unchanged
    And the exact reply reference reaches the CM5 resident
    And Android states that microphone input is unavailable

  Scenario: A personal control proof binds the original command bytes
    Given a phone stores the exact first control frame bytes
    When the desk challenges that frame under personal control role version two
    Then the proof binds the original frame digest and one request identifier
    And a changed frame, extra submission field, expired nonce or replay is refused
    And Console control protocols keep their existing behavior

  Scenario: Only the trusted main document can submit from the Android bridge
    Given an App frame or an external document is not the Shell main document
    When it tries to submit an owner request
    Then the native bridge refuses it before any request reaches CM5
    And a response for an old document cannot reach a new document

  Scenario: Network records and device verification stay within their owners
    Given a peer sends an oversized or malformed UTF-8 record
    When Android reads the link
    Then it refuses the record before unbounded buffering
    And device verification selects only this application and its own ADB forward

  Scenario: A refused read handshake keeps its bounded reason
    Given the desk refuses the phone before an owner turn exists
    When the desk reports a token refusal and closes the connection
    Then the phone reports that refusal as its dropped-link reason
    And control characters and oversized reason text cannot enter the reason
    And signed owner command text is never truncated

  Scenario: Android preserves recommendation recovery without response authority
    Given the phone shows the shared Personal Agent composer
    When a readable recovery frame arrives from the desk
    Then Android retains the recovery marker and the recommendation appears inside the composer
    And no recommendation popup opens or takes draft focus
    And withdrawn read access clears the recovery marker
    And recovery grants no response or presentation authority

  Scenario: Android reads asynchronous feedback memory status
    Given the desk saved feedback and published its memory refinement status
    When Android projects the readable recommendation
    Then a positive safe integer revision and the supported decision and status survive
    And queued, running, applied, failed, unavailable, and stale states remain distinct
    And only revision, decision, and status cross in the feedback learning metadata
    And extra worker fields and private data are removed
    And malformed feedback learning metadata clears readable recommendations
    And legacy recommendations do not acquire a memory refinement status
    And feedback, recovery, and typed input keep their existing contracts
    And response and presentation authority remain unavailable
