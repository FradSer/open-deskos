# Mali userspace GPU acceleration for the CM5 shell

## Status

Accepted.

## Context

CM5 bring-up reported the shell rendering through Chromium's software rasterizer even though
`--ignore-gpu-blocklist`, `--enable-gpu-rasterization`, and `--enable-zero-copy` were already
applied. Device inspection established the cause:

- The Rockchip 6.1 kernel already contains the ARM kbase driver. It probes `fb000000.gpu` as
  `mali0` with Kernel DDK version `g21p0-01eac0`; nothing needed a kernel change.
- The image shipped neither the CSF firmware (`mali_csffw.bin`) nor any ARM userspace blob. The
  first client open logged `Firmware initialization failed`, and EGL offered only Mesa's
  llvmpipe. Mesa cannot drive this GPU on this kernel: Mali-G610 is CSF-based and needs panthor
  with Mesa 24+, while this image has neither `DRM_PANTHOR` nor a Mesa new enough.
- Xorg already carried the vendor configuration (`/etc/X11/xorg.conf.d/20-modesetting.conf`) for
  `AccelMethod glamor` with `DRI 2`, and refused glamor because only llvmpipe was available.
- Chromium 150 no longer accepts a native GL implementation: `--use-gl=egl` is rejected as
  `gl=egl-gles2 ... not found in allowed implementations`, so only `gl=egl-angle` is available.

## Decision

- Install a pinned userspace pair from Rockchip's 6.1 SDK (`linux-6.1-stan-rkr4`): the CSF
  firmware and `libmali-valhall-g610-g24p0-x11-gbm.so`. This is the pairing the kernel accepts on
  this image. The blob generation the vendor build config names (g13p0) is EGL 1.4 only and
  cannot serve a modern glamor.
- `scripts/cm5-gpu-userspace.sh` owns that install, because no vendor package exists for this
  image: the blob directory plus `libEGL.so.1`, `libGLESv2.so.2`, and `libgbm.so.1` symlinks, with
  Mesa's libraries diverted through `dpkg-divert` into `odk-mesa/` so `ldconfig` cannot restore
  its software soname links. `remove` reverses everything it installed.
- The X server then initialises glamor against the Mali-G610, which is what makes the blob's X11
  EGL platform usable at all; before that, `eglInitialize` fails even for native clients.
- Chromium is pinned to ANGLE's GLES/EGL backend (`--use-gl=angle --use-angle=gles-egl`) and the
  display compositor stays in software (`--disable-gpu-compositing`). The blob loses the GPU
  context when Chromium swaps an X11 window surface, which crash-loops the GPU process; GPU
  rasterization and WebGL still run on the Mali GPU and only presentation stays a software copy.
- `resolveGpuBackend` selects this backend only on linux arm64 with the blob installed and an X11
  session. `ODESK_GPU_BACKEND=mali|default` overrides the choice, and `ODESK_DISABLE_GPU=1` or
  `LIBGL_ALWAYS_SOFTWARE=1` still forces software rendering.
- `scripts/cm5-acceptance.sh` reports the EGL vendor/version, the Xorg glamor accelerator, and the
  installed Mali userspace alongside the existing Mesa GLX `gpu-renderer` line. glxinfo keeps
  describing Mesa's software GLX path, so it is not acceleration evidence on its own.

## Consequences

- The graphical session must be restarted after install or removal before glamor and the shell
  pick up the change.
- `--disable-gpu-compositing` trades a GPU-composited presentation path for stability; the blob's
  X11 window-surface swap is unusable with this Xorg and driver combination.
- The blob and firmware are version-pinned to one SDK tag with checksums. A kernel or DDK change
  must re-pin firmware and blob together; the kernel reports `Kernel DDK version` and the firmware
  negotiates interface version `0x1010000`.
- Images whose Mesa can drive the GPU (mainline kernel with panthor and Mesa 24+) remain the
  cleaner long-term route and would retire the blob, the diversion, and the software-compositing
  trade-off.
- Verified on the device: `es2_info` reports `EGL_VENDOR: ARM` with `1.5 Valhall-"g24p0-00eac0"`,
  Xorg logs `glamor X acceleration enabled on Mali-G610`, and a scratch Electron window reports
  `ANGLE (ARM, Mali-G610, OpenGL ES 3.2)` with `gpu_compositing: disabled_software` and
  `rasterization: enabled_force`.