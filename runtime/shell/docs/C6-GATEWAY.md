# C6 Gateway Contract

The C6 Gateway is a future CM5 companion board. It forwards Remote Messages between the ESP32-S3 Remote Control and the Linux Remote Bridge. It does not own display state, emulate a keyboard, or decide page boundaries.

## Topology

```text
ESP32-S3 Remote Control
  <-> ESP-NOW (encrypted single peer)
ESP32-C6 Gateway
  <-> 3.3 V UART
CM5 Remote Bridge
  <-> Unix domain socket
Electron Display Shell
```

## UART Host Link

Use a crossed 3.3 V TTL UART connection: CM5 TX to C6 RX, CM5 RX to C6 TX, and a common ground. Do not connect either side to RS-232 voltage levels. Select the final CM5 UART only after confirming its pin mux and console ownership on the installed carrier board.

UART carries UTF-8 JSON Lines. Each record is at most 512 bytes and ends with `\n`. Invalid UTF-8, oversized records, malformed JSON, unsupported protocol versions, and unknown message types must be discarded without changing state.

## Remote Messages

The shared payload is versioned independently of the transport:

```json
{"v":1,"type":"navigate","direction":"next","id":"request-id"}
{"v":1,"type":"state","page":1,"pages":3,"name":"概览","canPrev":false,"canNext":true,"link":"wireless"}
```

S3 sends `navigate` through ESP-NOW only in wireless operation. The bridge forwards it to the Display Shell. The Shell then publishes the complete authoritative `state` back through the bridge, C6, and S3. The gateway must not derive a new page state from a navigation request.

## ESP-NOW Peer Boundary

The first wireless deployment permits one preconfigured S3 Remote Control peer. The C6 and S3 must configure each other's MAC address and ESP-NOW peer encryption keys. The gateway accepts remote messages only from that peer and drops all broadcast or unpaired traffic. Keys belong in device provisioning, never source control.

## Migration Boundary

The wired USB adapter and wireless UART/C6 adapter share the Remote Bridge message codec and the Display Shell Unix-socket contract. Adding C6 support must not require changes to the Shell page model or Remote Control state UI.
