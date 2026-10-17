#!/usr/bin/env bash
# Sourced by cm5-gpu-userspace.sh. Build only glamor, not the X server.
# Rockchip fix: https://github.com/JeffyCN/xorg-xserver/commit/abcfaefc1eb3f4d4340a218afc0ae2b38c3fb60d

XORG_SOURCE_VERSION="2:21.1.7-3+deb12u12"
GLAMOR_MODULE_DIR="/usr/local/lib/odk-xorg-bgra-21.1.7/modules"
GLAMOR_STATE_DIR="/var/lib/odk-glamor-bgra"
GLAMOR_CONFIG="/etc/X11/xorg.conf.d/10-odk-glamor-bgra.conf"
GLAMOR_XORG_LOG="/var/log/Xorg.0.log"
GLAMOR_PROC_DIR="/proc"
MODESETTING_CONFIG="/etc/X11/xorg.conf.d/20-modesetting.conf"
GLAMOR_PATCH="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/patches/xorg-glamor-bgra.patch"

xorg_source_version() {
  dpkg-query -W -f='${source:Version}' xserver-xorg-core
}

check_glamor_version() {
  local version
  version="$(xorg_source_version)"
  if [ "$version" != "$XORG_SOURCE_VERSION" ]; then
    echo "Unsupported Xorg version ${version}; expected ${XORG_SOURCE_VERSION}. Update the source pins and rebuild glamor." >&2
    return 1
  fi
}

glamor_manifest() {
  printf '%s\n' "$XORG_SOURCE_VERSION" "$(sha256sum "$GLAMOR_PATCH" | awk '{print $1}')" \
    "$(sha256sum "${GLAMOR_MODULE_DIR}/libglamoregl.so" | awk '{print $1}')"
}

glamor_module_current() {
  [ -r "${GLAMOR_MODULE_DIR}/libglamoregl.so" ] &&
    [ -r "${GLAMOR_STATE_DIR}/manifest" ] &&
    cmp -s <(glamor_manifest) "${GLAMOR_STATE_DIR}/manifest"
}

glamor_session_ids() {
  local boot_id pid
  boot_id="$(cat /proc/sys/kernel/random/boot_id)"
  while read -r pid; do
    printf '%s %s\n' "$boot_id" "$pid"
  done < <(pgrep -x Xorg || true)
}

glamor_module_config() {
  cat <<EOF
Section "Files"
    ModulePath "${GLAMOR_MODULE_DIR}"
    ModulePath "/usr/lib/xorg/modules"
EndSection
EOF
}

install_glamor_config() (
  set -e
  local tmp
  if { [ -e "$GLAMOR_CONFIG" ] && ! cmp -s <(glamor_module_config) "$GLAMOR_CONFIG"; } ||
     { [ -f "${GLAMOR_STATE_DIR}/modesetting.installed" ] && ! cmp -s "$MODESETTING_CONFIG" "${GLAMOR_STATE_DIR}/modesetting.installed"; }; then
    echo "Preserved changed Xorg configuration; reconcile it before installation." >&2
    exit 1
  fi
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  $SUDO install -d -m 0755 "$GLAMOR_STATE_DIR" "$(dirname "$GLAMOR_CONFIG")"
  if [ ! -e "${GLAMOR_STATE_DIR}/modesetting.original" ] && [ ! -e "${GLAMOR_STATE_DIR}/modesetting.absent" ]; then
    if [ -e "$MODESETTING_CONFIG" ]; then
      $SUDO cp -p "$MODESETTING_CONFIG" "${GLAMOR_STATE_DIR}/modesetting.original"
    else
      $SUDO touch "${GLAMOR_STATE_DIR}/modesetting.absent"
    fi
  fi
  if [ -e "$MODESETTING_CONFIG" ]; then
    if ! grep -Eq '^[[:space:]]*Driver[[:space:]]+"modesetting"' "$MODESETTING_CONFIG" ||
       ! grep -Eq '^[[:space:]]*Option[[:space:]]+"AccelMethod"' "$MODESETTING_CONFIG"; then
      echo "Cannot update ${MODESETTING_CONFIG}: expected the CM5 modesetting configuration." >&2
      exit 1
    fi
    sed -E 's/^([[:space:]]*Option[[:space:]]+"AccelMethod"[[:space:]]+)"[^"]*"/\1"glamor"/; /^[[:space:]]*Option[[:space:]]+"ShadowFB"/d' "$MODESETTING_CONFIG" > "$tmp"
  else
    cat > "$tmp" <<'EOF'
Section "Device"
    Identifier "Rockchip Graphics"
    Driver "modesetting"
    Option "AccelMethod" "glamor"
EndSection
EOF
  fi
  $SUDO install -m 0644 "$tmp" "$MODESETTING_CONFIG"
  $SUDO cp "$tmp" "${GLAMOR_STATE_DIR}/modesetting.installed"
  glamor_module_config > "$tmp"
  $SUDO install -m 0644 "$tmp" "$GLAMOR_CONFIG"
)

install_glamor() (
  set -e
  check_glamor_version
  if glamor_module_current; then
    echo "  matching BGRA glamor module already installed"
    install_glamor_config
    exit 0
  fi
  local build source pool
  build="$(mktemp -d)"
  trap 'rm -rf "$build"' EXIT
  pool="https://deb.debian.org/debian/pool/main/x/xorg-server"
  $SUDO apt-get install -y --no-install-recommends --no-upgrade \
    build-essential dpkg-dev quilt meson ninja-build pkg-config libpixman-1-dev \
    x11proto-dev xtrans-dev libxau-dev libxdmcp-dev libxfont-dev libxkbfile-dev \
    libpciaccess-dev libdrm-dev libepoxy-dev libegl-dev libgbm-dev \
    libxshmfence-dev libxcvt-dev nettle-dev libx11-xcb-dev mesa-common-dev
  download_verified "${pool}/xorg-server_21.1.7-3+deb12u12.dsc" "${build}/xorg-server.dsc" \
    a8c0d6f3adc7491cbf9ddf6f14af768a2ee6c7a40ee2eb4cb2c9197ef2393832 "Xorg source descriptor"
  download_verified "${pool}/xorg-server_21.1.7.orig.tar.gz" "${build}/xorg-server_21.1.7.orig.tar.gz" \
    1a9005f47c7ea83645a977581324439628a32c4426303e5a4b9c2d6615becfbf "Xorg source"
  download_verified "${pool}/xorg-server_21.1.7-3+deb12u12.diff.gz" "${build}/xorg-server_21.1.7-3+deb12u12.diff.gz" \
    273a9841c2189172305616b297a259fddf93f48380f77087328b6c832cea221c "Debian source changes"
  source="${build}/source"
  dpkg-source --no-check -x "${build}/xorg-server.dsc" "$source"
  cd "$source"
  # This Debian source uses format 1.0. Extraction does not apply its quilt series.
  QUILT_PATCHES=debian/patches quilt push -a
  patch --fuzz=0 -p1 < "$GLAMOR_PATCH"
  meson setup build -Dxorg=true -Dglamor=true -Dxnest=false -Dxvfb=false \
    -Dxephyr=false -Dxwin=false -Dxquartz=false -Dudev=false -Dudev_kms=false \
    -Dsystemd_logind=false -Ddocs=false -Ddevel-docs=false -Ddocs-pdf=false \
    -Dsecure-rpc=false -Dint10=false -Dlinux_acpi=false -Dlinux_apm=false
  ninja -C build -j4 hw/xfree86/glamor_egl/libglamoregl.so
  $SUDO install -d -m 0755 "$GLAMOR_MODULE_DIR" "$GLAMOR_STATE_DIR"
  glamor_session_ids > "${build}/sessions"
  $SUDO install -m 0644 "${build}/sessions" "${GLAMOR_STATE_DIR}/previous-xorg-sessions"
  $SUDO install -m 0755 build/hw/xfree86/glamor_egl/libglamoregl.so "${GLAMOR_MODULE_DIR}/libglamoregl.so"
  glamor_manifest > "${build}/manifest"
  $SUDO install -m 0644 "${build}/manifest" "${GLAMOR_STATE_DIR}/manifest"
  install_glamor_config
)

verify_glamor() {
  local sessions boot_id pid receipt
  check_glamor_version || return 1
  if ! glamor_module_current || ! cmp -s <(glamor_module_config) "$GLAMOR_CONFIG"; then
    echo "  BGRA glamor module is missing or changed; run cm5-gpu-userspace.sh install." >&2
    return 1
  fi
  sessions="$(glamor_session_ids)"
  if [ -z "$sessions" ]; then
    echo "  No running Xorg session can confirm the BGRA module; start the graphical session before verification." >&2
    return 1
  fi
  if [ -f "${GLAMOR_STATE_DIR}/previous-xorg-sessions" ] &&
     grep -Fxf <(printf '%s\n' "$sessions") "${GLAMOR_STATE_DIR}/previous-xorg-sessions" >/dev/null; then
    echo "  Xorg still uses the previous module; restart the graphical session." >&2
    return 1
  fi
  if [ "$(id -u)" -ne 0 ]; then
    if receipt="$(/usr/bin/timeout 5s /usr/bin/sudo -n -- /usr/local/libexec/odk-xorg-bgra-verify 2>&1)"; then
      printf '  %s\n' "$receipt"
    else
      printf '  %s\n' "$receipt" >&2
      echo "  BGRA mapping observation unavailable or failed; run the installed host verifier as root for diagnostics." >&2
      return 1
    fi
  else
    while read -r boot_id pid; do
      if ! awk -v module="${GLAMOR_MODULE_DIR}/libglamoregl.so" \
        '$6 == module && NF == 6 { loaded=1 } END { exit !loaded }' "${GLAMOR_PROC_DIR}/${pid}/maps"; then
        echo "  Xorg ${pid} does not map the installed BGRA module; restart the graphical session." >&2
        return 1
      fi
    done <<< "$sessions"
  fi
  if ! grep -Fq "Loading ${GLAMOR_MODULE_DIR}/libglamoregl.so" "$GLAMOR_XORG_LOG"; then
    echo "  Xorg has not loaded the BGRA module; restart the graphical session." >&2
    return 1
  fi
  echo "  BGRA glamor: matching module loaded; distribution module unchanged"
}

remove_glamor() {
  local archive file
  if [ -e "$GLAMOR_CONFIG" ]; then
    if ! cmp -s <(glamor_module_config) "$GLAMOR_CONFIG"; then
      echo "Preserved changed ${GLAMOR_CONFIG}; remove its module override before removing Mali." >&2
      return 1
    fi
    $SUDO rm "$GLAMOR_CONFIG"
  fi
  if [ -f "${GLAMOR_STATE_DIR}/modesetting.installed" ] && cmp -s "$MODESETTING_CONFIG" "${GLAMOR_STATE_DIR}/modesetting.installed"; then
    if [ -f "${GLAMOR_STATE_DIR}/modesetting.original" ]; then
      $SUDO cp -p "${GLAMOR_STATE_DIR}/modesetting.original" "$MODESETTING_CONFIG"
    elif [ -f "${GLAMOR_STATE_DIR}/modesetting.absent" ]; then
      $SUDO rm "$MODESETTING_CONFIG"
    fi
  fi
  if [ -f "${GLAMOR_STATE_DIR}/modesetting.installed" ]; then
    archive="$($SUDO mktemp -d "${GLAMOR_STATE_DIR}/removed.XXXXXX")"
    for file in modesetting.original modesetting.absent modesetting.installed; do
      if [ -e "${GLAMOR_STATE_DIR}/${file}" ]; then
        $SUDO mv "${GLAMOR_STATE_DIR}/${file}" "$archive/"
      fi
    done
  fi
  # Keep build receipts and backups for diagnosis. No local module path remains active.
}
