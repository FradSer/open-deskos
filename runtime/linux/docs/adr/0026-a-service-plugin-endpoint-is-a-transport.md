# A Service Plugin endpoint is a transport, not a Unix socket path

## Status

Accepted

## Context

ADR 0009 gave every Service Plugin one way to reach the shell: the shell listens on a Unix socket the plugin connects to, and ownership of that socket's private directory is what authenticates the plugin. That is enough while the plugin and the shell are the same machine, which is what the reference host has always been.

A second shell host now exists: a 64-bit Windows handheld. Two things break under the old contract. A Windows host has named pipes rather than Unix sockets, and a pipe carries no owner to authenticate with. And the plugin that has the data — the Futu poller, which holds the gateway's RSA key file and trade unlock — runs where the gateway is, so a second desk elsewhere needs the plugin to reach it over the network rather than over a file in a runtime directory.

The owner's requirement is explicit: a Service Plugin is an integration of the desk, and it must not be a Windows thing or a Linux thing.

## Decision

- A declared endpoint names where a plugin connects: an absolute socket path, a named pipe, or `tcp://host:port`. A bare relative name still resolves under the shell's runtime directory, which is the historical form.
- The transport is decided by the endpoint and nothing else. `runtime/linux/src/local-channel.js` owns that decision for every local channel in the shell, so a plugin, a Desk Link runtime channel, and the user-application control endpoint cannot disagree about it.
- Where ownership can authenticate, ownership stays the gate: a Unix socket lives in a directory only its owner can enter, mode `0700`, and the socket is mode `0600`. This is now enforced for the Service Plugin socket too, which previously inherited whatever the umask gave it and was world-connectable.
- Where ownership cannot authenticate — a named pipe, or a network address — the shared channel token authenticates: a 32-byte value in one file per host, presented as the first line of the connection, compared in constant time. A Unix socket endpoint still accepts a plugin that predates the token, which is what the reference host runs.
- A plugin may reach more than one desk. The poller declares its targets itself, because a remote desk's endpoint cannot be read from the desk's own configuration, and one unreachable target never stops the others.
- A declared `endpoint` wins over the historical `socket` field, so an installed app states one thing.

## Considered Options

- **Keeping the socket path and requiring plugins to be co-resident.** Rejected: it makes Futu, and every future plugin, a Linux-only integration and forces the credential-bearing poller onto every desk.
- **Exposing the socket to the network by forwarding.** Rejected: a forwarded socket still terminates on the desk's filesystem, and Windows cannot terminate a Unix socket at all, so this moves the same problem rather than solving it.
- **Publishing through the MQTT broker the plant feed already uses.** Rejected for the plugin contract: it makes the broker a dependency of every plugin and gives up the per-plugin handshake for a shared, unauthenticated broker. A plugin that wants MQTT can still be written as one; the contract should not require it.
- **Trusting the network.** Rejected: the desk accepts plugin pushes that become its display, so a host on the tailnet must not be able to write them without the token.

## Consequences

- One poller on the reference host feeds the reference desk over its socket and a Windows desk over the network, without the credential-bearing gateway secrets leaving the machine that already holds them.
- The Futu tile, and any future Service Plugin, is the same integration on either host.
- A desk that listens on a network address must be told so (`ODK_FUTU_ENDPOINT`) and its host firewall must allow that port; the token is what keeps the port from accepting writes from anything else on the tailnet.
- `runtime/linux/tests/service-plugin-endpoint.test.js` holds the transport's scenarios, including the ones that run on a Windows host.