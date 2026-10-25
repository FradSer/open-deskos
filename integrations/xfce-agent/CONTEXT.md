# Anonymous XFCE experiment handoff

Updated: 2026-10-24, Asia/Shanghai.

## Authorization and source

The owner authorized old release cleanup and one anonymous Chrome VM experiment on CM5.
Do not use real accounts, order products, change online model configuration, or activate production services.
The owner selected the existing provider route after its quota failure.
Real visual acceptance completed after that quota recovered. Keep the same provider route.

All changes are uncommitted in `/Users/FradSer/.codex/worktrees/xfce-anonymous-loop/open-deskos`.
The base is `origin/main` at `76d8578fbe727fa8fb23039f9441b9852c26a06c`.
The original checkout has unrelated changes. Do not alter or reset them.
The fixed reviewed desktop capability belongs to `integrations/personal-bot/`.
The independent worker and guest belong to `integrations/xfce-agent/`.
No commit, push, or production activation was requested.

## Cleanup evidence

Nine old releases were archived, compared, hashed, revalidated, and deleted under the deployment lock.
Cleanup released 6,895,570,944 bytes. Root usage fell from 91% to 67% before experiment dependencies.
The current, previous, process-referenced release, state, staging, and previous backups were preserved.
Keep `20261021-main-5de39344` even though its earlier poller process subsequently ended.
Archive: `/mnt/ssd/odk-system-disk-archive/20261024-release-cleanup-164226Z-af88f096/`.
The archive SHA-256 is `6d86b85785091ed27288ebda0a5cf86a03483185a97cae3c7778113f43bedcd6`.
The archive contains its manifest and `SHA256SUMS`.
At 02:09 Beijing time, root usage was 75%, with 7.03 GB available.
A separate stage-only deployment added release `20261024-main-95bf3e1c`, approximately 904 MB. It was not activated.
Preserve that release. The current and previous links still select `76d8578f` and `da0701c3`.
Experiment source and runtime occupy approximately 114 MB on root. VM images and evidence stay on SSD.
No per-directory baseline exists for all root growth. Do not attribute the entire increase to the new release.
At 02:35 Beijing time, root usage reached 85%, with approximately 4.31 GB available.
Other stage-only releases, two Gmail component releases, and Docker storage increased during this interval.
The release `3cc319b8` still had an active deployment process. Preserve all new releases.
The Personal Bot and Shell process identities, current links, and model configuration hashes remained unchanged.

## Actual CM5 guest

Connect with SSH alias `cm5`. Run worker and supervisor as `orangepi`, UID 1000.
The guest uses Debian 13 ARM64, kernel 6.12.113, XFCE, X11, and Chromium 156.
KVM uses two vCPUs and 4096 MiB. QEMU stays on A76 host cores 4 through 7.
The viewport is 1280 by 800. Input uses virtio keyboard and tablet devices.
Cold, idle, desktop-session restart, and restart-plus-idle input probes all passed.
Acceptance networking uses `restrict=on`; guest outbound TCP was rejected in the device check.
QMP: `/run/user/1000/odk-xfce-lab/qmp.sock`.
VNC: `/run/user/1000/odk-xfce-lab/vnc.sock`.
The fixture monitor is `http://127.0.0.1:18081`.
Guest bootstrap SSH is loopback port 18022. Its temporary key stays in the private host runtime directory.

The SSD pool is `/mnt/ssd/open-deskos/vm-lab/xfce-fixture-v1`.
It mounts a new 24 GiB ext4 container with `nosuid,nodev,noexec,noatime`.
The outer SSD is exFAT. No partition, existing mount, or fstab entry was changed.
The guest disk is thin-provisioned at 32 GiB; the pool has less physical capacity.
The supervisor enforces experiment storage reserves. This is not an encrypted account storage pool.

Chromium policy and Xorg files must be `0644` so the desktop user can read them.
Chromium uses a new user-owned `0700` profile and cache on guest tmpfs for each session.
An earlier `0600` policy file caused a password-save prompt. Those acceptance images are superseded.
The old guest profile is quarantined under `/var/lib/odk/private-quarantine`, owned by root with mode `0700`.
Do not read, export, or reuse that profile.

## Runtime paths and tests

CM5 staged code: `/home/orangepi/.local/share/odk-xfce-lab/runtime-v1`.
The staged Personal Bot reads pinned production dependencies through a read-only dependency symlink.
It does not edit the production package or its configuration.
Template: `/mnt/ssd/open-deskos/vm-lab/xfce-fixture-v1/worker-template.json`.
The operator port is 18082 on loopback. Task sockets and capture buffers use private host tmpfs.
Public evidence and journals use the private SSD pool. Never export `operator-key.json`.
Provider configuration: `/home/orangepi/.pi/agent/models.json`, provider `bailian`, model `gpt-6-luna`.
Credentials are read internally. Image capability and reasoning settings change only in worker memory.

The coordinator uses actual Pi Durable 1.2, Code Mode, and fixed reviewed task tools.
Its acceptance decisions are synthetic. It never receives screenshots or private tickets.
`fixture-controller-worker.mjs` is explicitly synthetic and demonstrates no model vision.
Use `--synthetic-worker` only for device control tests.
Default live acceptance uses the actual configured visual model.

The final worker suite passed all 58 checks on CM5.
The adapter has 24 passing checks and a passing typecheck.
The guest privacy revision has 13 passing Python checks and valid shell syntax.
Independent reviews found and repaired storage, release, private VNC, and initialization races.
The final independent review passed 39 focused checks and found no P1 or P2 blockers within the anonymous fixture scope.
Unknown dispatch recovery remains fail closed. Device restart testing covers a pending decision, not an unknown dispatched mutation.

## Evidence and limits

Root: `/mnt/ssd/open-deskos/vm-lab/xfce-fixture-v1/`.
`acceptance-20261024-r1` and `r2` preserve failed real visual requests.
The provider returned HTTP 429, `model_cooldown`, and `usage_limit_reached` before inference.
A diagnostic at 17:26 UTC reported about 3888 seconds until quota recovery.
At 02:35 Beijing time, the existing provider resumed successful image-bearing `gpt-6-luna` responses.
The real visual run `acceptance-visual-20261024-0235-r1/report.json` passed all four cases.
It completed at 18:37:41 UTC on 2026-10-23 and preserved 24 public frames.
Baseline, private takeover, and recovery each verified one 1 metre USB-C cable at USD 11.99, quantity one.
Cancellation prevented late task changes and further model requests.
The private case froze observations, closed VNC on resume, and excluded its synthetic inputs from final logs.
The resumed frame and final cart frames were visually inspected after export.
This run used the real visual worker with actual Pi Durable delegation and synthetic coordinator decisions.
Metadata records 24 image requests: 22 successful tool calls, one aborted request, and one killed request without a terminal record.
Independent review matched the report, task state, ten Pi receipts, and PNG metadata without evidence contradictions.
Interrupted provider requests have incomplete usage records. No monetary cost estimate is established.
The fixture was local. No real account, Amazon task, payment, or production activation was involved.
Do not relabel earlier synthetic control results as visual acceptance.

Control runs before the policy correction are superseded, including `acceptance-control-20261024-r5`.
Those assertions passed, but later frames contained a masked password-save prompt.
Local exports were moved to `/Users/FradSer/.local/state/odk-xfce-lab/quarantine/20261024-control-r5`.
Runs `r6` and `r7` exposed input delivery failures after the new desktop session.
The final `acceptance-control-20261024-r8/report.json` passed all four device control cases.
It completed at 18:04 UTC on 2026-10-23, with 77 public frames and no model inference.
The private case froze model requests and evidence, closed VNC on resume, and excluded synthetic credentials from final logs.
A fresh private memory frame passed the known password-save prompt regression probe before dismissal.
That fixed-pixel probe covers this known fixture regression. It is not a general private-data detector.
Public baseline, first-resume, and final-private frames were visually inspected after export.
Transient workers are stopped. The restricted VM remains available for authorized experiment work.

Local public evidence root:
`/Users/FradSer/.codex/visualizations/2026/10/23/01a167dd-b1a9-7b40-be5a-7d18813af4b0/xfce-anonymous-loop-20261024`.
Only export public PNGs, bounded reports, sanitized request metadata, and host evidence.
Never export operator keys, browser profiles, private pixels, or private form bodies.

The one-time heartbeat `xfce` completed its acceptance work and was deleted.
No further scheduled model calls remain. Keep the existing provider and model.

Run default visual acceptance as `orangepi` from the staged `integrations/xfce-agent` directory:

```sh
node scripts/test-anonymous-loop-live.mjs \
  --config /mnt/ssd/open-deskos/vm-lab/xfce-fixture-v1/worker-template.json \
  --directory /mnt/ssd/open-deskos/vm-lab/xfce-fixture-v1/acceptance-visual-UNIQUE
```

Choose a new directory each time. The harness rejects reused case directories.
Keep the existing VM restricted. Preserve all failed runs.
After acceptance, stop transient workers, update this file, and report exact evidence limits.
Do not touch the earlier real Amazon profile, screenshots, cart, or checkout.
