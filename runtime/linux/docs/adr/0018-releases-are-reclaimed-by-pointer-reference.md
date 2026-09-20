# Releases are reclaimed by pointer reference

## Status

Accepted.

## Context

Every update builds a sealed release of roughly 640 MB and the device kept all of them. A device
that had updated a few times carried four releases, 2.5 GB, with no policy stating which of them
still mattered. Nothing referenced them: two pointers already describe everything the device can
execute, `current` for the active release and `previous` for the rollback target.

The failed activations during CM5 bring-up made the cost visible, because each attempt left another
candidate behind, and reclaiming them was a manual `rm -rf` that only someone who knew the pointer
layout could perform safely.

## Decision

- A completed activation reclaims every directory under `releases/` that neither pointer references.
  `pruneReleases` runs inside the same locked transaction as the activation, after the post
  activation smoke has passed.
- Only directories carrying `release.json` are candidates for reclaiming, so a stray directory under
  `releases/` is never deleted, and a failure to reclaim one release is reported on stderr without
  failing the update. The CLI result carries the reclaimed IDs as `pruned`.
- A failed activation reclaims nothing. Its candidate is what an operator inspects afterwards, and
  the next successful activation reclaims it.

## Consequences

- Rollback depth is one release by design. A release older than `previous` is unreachable and is
  deleted, so restoring three updates back is not a recovery option.
- Disk use stays bounded at two releases, about 1.3 GB on the CM5, instead of growing per update.
- Manual deletion is no longer part of the update procedure; an operator who needs to free space
  removes the pointers' releases deliberately rather than the newest directories.
- Verified by `tests/runtime-release.test.js`: an activation over four releases reclaims the two
  unreferenced ones while the active release, the rollback target, and a non-release directory
  survive, and a failed activation reclaims nothing.