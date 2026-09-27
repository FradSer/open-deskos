Feature: The runtime channel keeps an authentication of its own on every host

  A runtime channel is a local connection between the Display Shell and one of
  its own services. On a Unix host the socket sits in a directory only its owner
  can enter, so ownership is what authenticates a peer. A Windows host has named
  pipes instead, and a pipe carries no owner, mode, or uid, so a channel that
  ownership cannot authenticate authenticates with a token this user keeps in a
  file only this user can read.

  Scenario: A Unix channel is authenticated by ownership
    Given a channel endpoint on a Unix host
    When a client connects without a token
    Then the service accepts it, because only this user could have opened that socket
    And the service's own protocol reads the request from its first byte

  Scenario: A channel ownership cannot authenticate requires the token
    Given a channel endpoint that has no owner to check
    When a client connects without a token
    Then the service closes the connection before its protocol sees anything

  Scenario: The handshake is consumed rather than handed to the protocol
    Given a channel that requires a token
    When a client sends the handshake and its request in a single write
    Then the service's protocol reads the request and never sees the handshake

  Scenario: The token is a file only its owner can read
    Given no token exists yet for this host
    When two processes ask for the token at the same time
    Then both receive the same token
    And the file holds it in a form only this user can read

  Scenario: A stopped service's socket is replaced, a live one is never stolen
    Given a socket file left behind by a service that is gone
    When a new service listens on that endpoint
    Then the new service takes the endpoint over
    Given a service that is still listening
    When a second service tries the same endpoint
    Then it refuses, and the first service keeps answering