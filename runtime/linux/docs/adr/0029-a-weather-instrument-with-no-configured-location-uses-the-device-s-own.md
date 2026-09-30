# A Weather Instrument with no configured location uses the device's own

## Status

Accepted. Extends ADR-0010's location rule, which remains true wherever a host is
given coordinates: only a host given no location at all may ask the device where it
is, and an explicit empty location still pins the lookup off.

## Context

ADR-0010 made the Weather Instrument's location configuration and said "never a
guess", with the tile reading `Unconfigured` and naming the setting. That is right
for the reference host, which is given coordinates. It is wrong for the second
Shell Host: a 64-bit Windows handheld is a computer the owner carries between
networks, and a desk that needs a latitude and longitude edited by hand to show
the weather where it is standing is a desk the owner stops trusting.

The host already has a network path, because the weather request itself uses one.
The question is whether the desk may ask *where this host is* over that path, and
what it may do with the answer.

## Decision

- A host given coordinates still decides its own location. Configured latitude and
  longitude always win, and nothing about them changes.
- A host given no location at all may resolve the device's own location, and only
  then. A host handed a location explicitly — including the empty location a smoke
  run constructs — never performs the lookup, so `--smoke` stays offline.
- The lookup is keyless and anonymous. It asks a plain geolocation endpoint with no
  account, no credential, and nothing the host already knows beyond the request a
  network call carries. The endpoint is overridable with `ODK_LOCATION_URL`, and
  the answer is reused for `ODK_LOCATION_REFRESH_MS` so a desk on a desk does not
  re-ask it on every refresh.
- The request is bounded: a timeout aborts it, and the timeout is not lengthened by
  configuration. A dead or slow provider cannot delay a weather reading, and it
  never retries within a refresh.
- A failed lookup publishes a reason and no coordinates. It never substitutes a
  placeholder, a default city, or a cached answer from a different place: with no
  location in force, the tile keeps reading `Unconfigured` and names the setting,
  exactly as ADR-0010 specifies.
- The lookup runs in the main process, before the weather request, and never on the
  render path. The four internal states ADR-0010 fixed are unchanged; what changed
  is which of them a host with no coordinates can reach.
- Every weather snapshot states where its location came from — configured or device
  — so a reading can be read as what it is.

## Consequences

- A handheld carried to another city shows that city's weather without anyone
  editing a configuration file, and the reference host's configured path is
  untouched, so the two hosts do not have to be told apart in the code.
- Asking a third party where the desk is has a cost the owner should be able to see
  and refuse. The answer is: turn the coordinates on, and the lookup does not happen
  at all. The reference host is that case today, which is why this decision does not
  change its behaviour.
- A desk that cannot reach the provider still degrades honestly, to `Unconfigured`
  with the setting named, rather than to a plausible-looking wrong city.
- The tile can display a location the owner never typed. That is the point, and it
  is also the thing a future change should be careful about: a reading whose
  provenance is not visible would make an unconfigured desk indistinguishable from
  a configured one, which is why the snapshot states the source.
