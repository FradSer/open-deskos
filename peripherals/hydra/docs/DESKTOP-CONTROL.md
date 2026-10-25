# HDC1 desktop control wire

This contract extends the telemetry-only baseline. It does not authorize hardware operations.
Telemetry v1 remains unchanged. The existing Bridge carries opaque packets.
The main node requires a separate, private 32-byte control key.
The host broker owns this key and requires user confirmation before each action.
A generic App peer-send grant does not provide this key.
Main-to-leaf FleetMessage broadcasts retain their existing trust boundary.
A control ACK does not prove end-to-end encryption or pump execution.

## Fixed packet

Every packet has exactly 128 bytes. Integers use little-endian encoding.
The HMAC is SHA-256 with the complete 32-byte key.
It authenticates bytes 0 through 95, including both MAC addresses.
Unused body bytes and padding must be zero.

| Offset | Bytes | Value |
| --- | --- | --- |
| 0 | 4 | ASCII `HDC1` |
| 4 | 1 | Type |
| 5 | 6 | Main node STA MAC |
| 11 | 6 | Selected gateway STA MAC |
| 17 | 8 | Main boot identity, nonzero random uint64 |
| 25 | 16 | Main random challenge |
| 41 | 8 | Command ID, uint64 |
| 49 | 4 | Device monotonic deadline, uint32 milliseconds |
| 53 | 1 | Body length, 0..40 |
| 54 | 40 | Body |
| 94 | 2 | Zero padding |
| 96 | 32 | HMAC tag |

## Types and bodies

| Type | Name | Body |
| --- | --- | --- |
| 1 | Query | Empty |
| 2 | Challenge response | Last-issued command ID, uint64 |
| 3 | Water | Node uint8; duration uint32 milliseconds, 1..30000 |
| 4 | Stop desktop owner | Node uint8 |
| 5 | Plan | Node uint8; windowSeq uint32; season uint8; count uint8; entries |
| 6 | ACK | Node uint8; code uint8; physical-owner bool uint8; leaseEnd uint32 |
| 7 | Heartbeat | Node uint8; counter uint32, positive |

Each plan entry has offsetMinutes uint16, intent uint8, and night bool uint8.
A plan has at most four entries. Its body length is exactly `7 + 4 * count`.
Offsets increase strictly within 0..239. Intents are TopUp=2, Standard=3, or DeepSoak=4.
The season uses the existing Season enum. Window identity must be positive and increase per node.
A zero-entry plan suspends routine triggers for four hours. Existing critical-dry protection remains active.

ACK codes are Accepted=1, LeafInstalled=2, and LeafRejected=3.
Accepted means the main node admitted the command. It does not prove delivery or execution.
LeafInstalled requires a matching leaf installation observation. It does not prove watering.
The physical-owner flag reports main-node physical force at the response time.
It does not report a leaf's separate local force button.
Water ACK carries the fixed lease end. Other ACKs carry zero.
ACK header deadline equals response time plus 5000ms.
A cached duplicate ACK retains its original bytes and original time reference.

## Challenge lifecycle

All queries require valid HMAC and the selected MAC pair.
Query boot, challenge, deadline, and body must be zero.
Command ID zero requests status only. Its response has zero challenge and deadline.
The status response returns the signed boot identity and last-issued ID.
The host selects an ID greater than that high-water mark.
The device rejects exhausted uint64 command space until its next boot.

A new nonzero query issues one challenge for five seconds.
A repeated pending query returns the same challenge and deadline without renewal.
A newer query replaces the previous pending challenge.
Expired or consumed IDs cannot obtain another challenge.
The response header deadline is the exact challenge deadline.
The response body contains the last-issued ID.

An action must match the boot, pending ID, challenge, and exact challenge deadline.
The device validates the complete action before it consumes the challenge.
A successful action executes once. An identical cached action returns its original ACK.
A conflicting action, an older ID, or an expired challenge performs no action.
The cache holds one accepted action. Cache eviction never resets the high-water mark.
The host does not retry actuator commands after an unknown result.

## Water lease

The device limits each desktop lease to thirty seconds.
The host sends signed heartbeat packets about every 250ms.
Heartbeat boot, challenge, and command ID match the accepted water command.
Its counter increases strictly. Its deadline is independent of the original challenge deadline.
The device requires `0 < deadline - now <= 1000`, using uint32 arithmetic.
That deadline cannot exceed the fixed lease end.
The host derives device time from the authenticated ACK and uses a TTL at most 750ms.
The host stops heartbeats when the action result is unknown.

No heartbeat or duplicate action can extend the total lease.
A heartbeat cannot revive an expired, disconnected, or stopped lease.
After 1000ms without accepted contact, the main node releases only its desktop owner.
The existing leaf watchdog releases the main's remote owner after missing broadcasts for one second.
A stop does not cancel physical force or claim that all pump owners are off.

## Acceptance boundary

Local tests and builds do not prove radio delivery, pump operation, or physical installation.
Firmware provisioning, flashing, and live irrigation require separate authorization.

## Leaf observation

FleetMessage keeps its v6 layout and length. Existing field offsets do not change.
The additive message type 12 reports plan installation.
It carries the original timetable fields, node ID, source MAC, and `pumpOn` as an installation boolean.
All other payload fields stay zero. Older firmware ignores this unknown message type.
The main checks the actual radio source against its roster and compares the complete accepted timetable.
An exact plan retry returns the previous installation result without restarting the window.
This observation reports installation history, not current window activity or watering completion.
The receipt cache is volatile. Existing leaf broadcasts remain unauthenticated.
