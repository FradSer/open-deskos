Feature: Tailscale as a provisioned part of the desk

  Tailscale is how the desk is reached from outside its own network, so it is part
  of a desk deployment rather than an optional extra. The rule that matters most is
  the reuse rule: a host that already has Tailscale keeps its own installation, its
  own login, and its own configuration.

  Scenario: A host that already has Tailscale is reused
    Given the host has a Tailscale command at the location its platform uses
    When the desk resolves Tailscale for this host
    Then it reports the host's own installation as the one to use
    And it does not install anything over it

  Scenario: A host without Tailscale is provisioned once
    Given the host has no Tailscale command
    When the desk resolves Tailscale for this host
    Then it reports Tailscale as absent and names the command it would use
    And provisioning may install it exactly once

  Scenario Outline: Each host is asked for Tailscale where its platform keeps it
    Given the desk resolves Tailscale on "<platform>"
    Then the command it looks for is "<command>"
    And the service it expects is "<service>"

    Examples:
      | platform | command                                      | service    |
      | win32    | C:\Program Files\Tailscale\tailscale.exe     | Tailscale  |
      | linux    | /usr/bin/tailscale                           | tailscaled |
      | darwin   | /usr/local/bin/tailscale                     | (none)     |

  Scenario: An unsupported host says so instead of guessing a path
    Given the desk resolves Tailscale on a platform it has no location for
    Then it reports Tailscale as unsupported
    And it looks for no command

  Scenario Outline: The desk states the tailnet state the CLI reported
    Given the tailscale status payload reports "<backend>"
    Then the desk reads the state as "<state>"

    Examples:
      | backend    | state       |
      | Running    | connected   |
      | NeedsLogin | needs-login |
      | Stopped    | stopped     |

  Scenario: A status payload the desk cannot read is not a state
    Given a tailscale status payload that is not usable JSON
    Then the desk reports no state rather than inventing one

  Scenario: Peer counts come from the payload, and missing facts stay missing
    Given a tailscale status payload with two peers, one of them online
    Then the desk reports two peers and one online
    And a payload with no peer map reports no peer count at all