#!/usr/bin/env bash
# Run ON the CM5 (Debian bookworm, arm64, Rockchip 6.1 kernel) as root.
#
# The Rockchip 6.1 kernel already ships the ARM kbase driver (Mali-G610 is
# probed as /dev/mali0), but the image lacks the CSF firmware and the ARM
# userspace blob. Without them Chromium renders through llvmpipe on the CPU.
# This script installs the pinned firmware and userspace blob and points the
# EGL/GLES/GBM sonames at the blob, keeping Mesa's libraries diverted so
# ldconfig cannot restore its software soname links.
#
# Usage: cm5-gpu-userspace.sh [install|remove|verify]
#
# The X session must be restarted after install or remove so the X server
# initialises glamor against the Mali blob (see the verify output).
set -euo pipefail

MALI_TAG="linux-6.1-stan-rkr4"
MALI_BASE_URL="https://gitlab.com/rockchip_linux_sdk_6.1/linux/libmali/-/raw/${MALI_TAG}"
MALI_BLOB_FILE="libmali-valhall-g610-g24p0-x11-gbm.so"
MALI_BLOB_SHA256="928ab0ae3346c06a061181445ef1afd1dcfb0c8e055491f08ffc59aeb1a8e785"
MALI_FIRMWARE_FILE="mali_csffw.bin"
MALI_FIRMWARE_SHA256="60ffa376edec8c402dc0ee9357c685d835ec2e0fb3d0778f303d08a9802d57f1"

LIB_DIR="/usr/lib/aarch64-linux-gnu"
MALI_BLOB_DIR="${LIB_DIR}/libmali"
MESA_DIVERSION_DIR="${LIB_DIR}/odk-mesa"
FIRMWARE_DIR="/lib/firmware"

# Soname aliases Chromium, Xorg (glamor) and GBM clients resolve at runtime.
SONAMES=(libEGL.so.1 libGLESv2.so.2 libgbm.so.1)
# Mesa libraries behind those sonames, diverted so ldconfig stops re-creating
# its software symlinks while the blob owns the names.
MESA_FILES=(libEGL.so.1.1.0 libGLESv2.so.2.1.0 libgbm.so.1.0.0)

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "This script needs root privileges: run as root or install sudo." >&2
    exit 1
  fi
  SUDO="sudo"
fi

check_arch() {
  if [ "$(uname -m)" != "aarch64" ]; then
    echo "This script targets arm64 (CM5). Current arch: $(uname -m)" >&2
    exit 1
  fi
}

require_tools() {
  local missing=()
  for tool in curl sha256sum dpkg-divert ldconfig; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Missing required tools: ${missing[*]}" >&2
    exit 1
  fi
}

sha256_of() {
  [ -r "$1" ] || return 1
  sha256sum "$1" | awk '{print $1}'
}

download_verified() { # url dest expected_sha description
  local url="$1" dest="$2" expected="$3" description="$4"
  local actual
  actual="$(sha256_of "$dest" || true)"
  if [ "$actual" = "$expected" ]; then
    echo "  ${description} already verified at ${dest}"
    return 0
  fi
  local tmp
  tmp="$(mktemp "${dest}.XXXXXX")"
  echo "  downloading ${description} from ${url}"
  if ! curl -fsSL --retry 2 --max-time 300 -o "$tmp" "$url"; then
    rm -f "$tmp"
    echo "  failed to download ${description}" >&2
    return 1
  fi
  actual="$(sha256_of "$tmp")"
  if [ "$actual" != "$expected" ]; then
    rm -f "$tmp"
    echo "  checksum mismatch for ${description}: expected ${expected}, got ${actual}" >&2
    return 1
  fi
  $SUDO install -m 0644 "$tmp" "$dest"
  rm -f "$tmp"
  echo "  installed ${dest}"
}

divert_mesa_file() { # file
  local file="$1"
  if [ ! -e "${LIB_DIR}/${file}" ]; then
    return 0
  fi
  if [ -e "${MESA_DIVERSION_DIR}/${file}" ]; then
    echo "  ${file} is already diverted"
    return 0
  fi
  $SUDO dpkg-divert --add --rename --divert "${MESA_DIVERSION_DIR}/${file}" "${LIB_DIR}/${file}" >/dev/null
  echo "  diverted Mesa ${file} to ${MESA_DIVERSION_DIR}/"
}

install_blob() {
  echo "== installing Mali userspace blob =="
  $SUDO install -d -m 0755 "$MALI_BLOB_DIR" "$MESA_DIVERSION_DIR"
  download_verified "${MALI_BASE_URL}/lib/aarch64-linux-gnu/${MALI_BLOB_FILE}" "${MALI_BLOB_DIR}/${MALI_BLOB_FILE}" "$MALI_BLOB_SHA256" "libmali blob"

  for file in "${MESA_FILES[@]}"; do
    divert_mesa_file "$file"
  done

  $SUDO ldconfig
  for soname in "${SONAMES[@]}"; do
    $SUDO ln -sfn "${MALI_BLOB_DIR}/${MALI_BLOB_FILE}" "${LIB_DIR}/${soname}"
  done
  # ldconfig only re-creates a soname link when it can see a library claiming
  # that soname, so the links above survive; re-assert after ldconfig anyway.
  $SUDO ldconfig
  for soname in "${SONAMES[@]}"; do
    $SUDO ln -sfn "${MALI_BLOB_DIR}/${MALI_BLOB_FILE}" "${LIB_DIR}/${soname}"
  done
}

install_firmware() {
  echo "== installing Mali CSF firmware =="
  download_verified "${MALI_BASE_URL}/firmware/g610/${MALI_FIRMWARE_FILE}" "${FIRMWARE_DIR}/${MALI_FIRMWARE_FILE}" "$MALI_FIRMWARE_SHA256" "Mali CSF firmware"
}

install_all() {
  check_arch
  require_tools
  install_firmware
  install_blob
  echo "== installed =="
  echo "The GPU stays unused until a client opens /dev/mali0 and the X session"
  echo "re-initialises glamor; restart the graphical session (or reboot) next."
  verify_all || true
}

remove_all() {
  check_arch
  require_tools
  echo "== removing Mali userspace blob =="
  for soname in "${SONAMES[@]}"; do
    if [ -L "${LIB_DIR}/${soname}" ] && [ "$(readlink -f "${LIB_DIR}/${soname}")" = "${MALI_BLOB_DIR}/${MALI_BLOB_FILE}" ]; then
      $SUDO rm -f "${LIB_DIR}/${soname}"
    fi
  done
  for file in "${MESA_FILES[@]}"; do
    if [ -e "${MESA_DIVERSION_DIR}/${file}" ]; then
      $SUDO dpkg-divert --remove --rename --divert "${MESA_DIVERSION_DIR}/${file}" "${LIB_DIR}/${file}" >/dev/null
      echo "  restored Mesa ${file}"
    fi
  done
  $SUDO rmdir "$MESA_DIVERSION_DIR" 2>/dev/null || true
  $SUDO rm -rf "$MALI_BLOB_DIR"
  if [ "$(sha256_of "${FIRMWARE_DIR}/${MALI_FIRMWARE_FILE}" || true)" = "$MALI_FIRMWARE_SHA256" ]; then
    $SUDO rm -f "${FIRMWARE_DIR}/${MALI_FIRMWARE_FILE}"
    echo "  removed ${FIRMWARE_DIR}/${MALI_FIRMWARE_FILE}"
  fi
  $SUDO ldconfig
  echo "== removed =="
  echo "Restart the graphical session so Xorg falls back to the software path."
}

verify_all() {
  local status=0
  echo "== verification =="
  if [ -e /dev/mali0 ]; then
    echo "  kbase device: /dev/mali0 present"
  else
    echo "  kbase device: MISSING /dev/mali0 (kernel driver not probed)" >&2
    status=1
  fi
  local firmware_sha
  firmware_sha="$(sha256_of "${FIRMWARE_DIR}/${MALI_FIRMWARE_FILE}" || true)"
  if [ "$firmware_sha" = "$MALI_FIRMWARE_SHA256" ]; then
    echo "  csf firmware: ${FIRMWARE_DIR}/${MALI_FIRMWARE_FILE} verified"
  else
    echo "  csf firmware: MISSING or unexpected (${firmware_sha:-none})" >&2
    status=1
  fi
  local blob_sha
  blob_sha="$(sha256_of "${MALI_BLOB_DIR}/${MALI_BLOB_FILE}" || true)"
  if [ "$blob_sha" = "$MALI_BLOB_SHA256" ]; then
    echo "  userspace blob: ${MALI_BLOB_DIR}/${MALI_BLOB_FILE} verified"
  else
    echo "  userspace blob: MISSING or unexpected (${blob_sha:-none})" >&2
    status=1
  fi
  for soname in "${SONAMES[@]}"; do
    local target
    target="$(readlink -f "${LIB_DIR}/${soname}" 2>/dev/null || true)"
    if [ "$target" = "${MALI_BLOB_DIR}/${MALI_BLOB_FILE}" ]; then
      echo "  ${soname} -> Mali blob"
    else
      echo "  ${soname} -> ${target:-unresolved} (expected the Mali blob)" >&2
      status=1
    fi
  done
  if [ -r /var/log/Xorg.0.log ]; then
    local glamor
    glamor="$(grep -i "glamor X acceleration enabled" /var/log/Xorg.0.log | tail -n1 || true)"
    if [ -n "$glamor" ]; then
      echo "  xorg: $(printf '%s' "$glamor" | sed 's/^.*(II) //')"
    else
      echo "  xorg: glamor has no Mali device in /var/log/Xorg.0.log (restart the session)" >&2
      status=1
    fi
  fi
  if command -v es2_info >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then
    local egl_user="${SUDO_USER:-}" xauth="" egl=""
    if [ -z "$egl_user" ] && [ "$(id -u)" -eq 0 ]; then
      egl_user="$(loginctl list-sessions --no-legend 2>/dev/null | awk '$2 >= 1000 { print $3; exit }')"
    fi
    if [ -n "$egl_user" ] && [ -r "/home/${egl_user}/.Xauthority" ]; then
      xauth="/home/${egl_user}/.Xauthority"
      egl="$(su - "$egl_user" -c "DISPLAY=${DISPLAY} XAUTHORITY=${xauth} es2_info" 2>/dev/null | grep -E 'EGL_VENDOR|EGL_VERSION' | tr '\n' ' ' || true)"
    fi
    if [ -n "$egl" ]; then
      echo "  egl: ${egl}"
    else
      echo "  egl: no EGL probe (run this inside the desktop session as ${egl_user:-the graphical user})"
    fi
  fi
  return "$status"
}

case "${1:-install}" in
  install) install_all ;;
  remove) remove_all ;;
  verify) check_arch; verify_all ;;
  *)
    echo "Usage: $(basename "$0") [install|remove|verify]" >&2
    exit 2
    ;;
esac