#!/usr/bin/env bash
# Run ON the CM5 (Debian/Ubuntu, arm64) as root.
# Idempotently provisions the agent-browser CLI and its Chrome for Testing
# browser under /opt/agent-browser, then verifies a real headless interaction
# as the kiosk user. The CLI is the Personal Bot's browser infrastructure.
#
# Subcommands:
#   install  (default) install the pinned pair, resolve dependencies, then verify
#   verify   run only the interaction probe against the installed pair
set -euo pipefail

INSTALL_DIR="/opt/agent-browser"
CLI_BIN="${INSTALL_DIR}/bin/agent-browser"
BROWSERS_DIR="${INSTALL_DIR}/browsers"
PROBE_SESSION="odk-agent-browser-provision"
PROBE_TIMEOUT="${ODK_AGENT_BROWSER_PROBE_TIMEOUT:-120}"

# The pinned pair is a decision, not a preference: a newer CLI may require a
# newer Chrome, and an unreviewed Chrome changes the security surface of a
# device that already runs an unattended browser.
AGENT_BROWSER_VERSION="${ODK_AGENT_BROWSER_VERSION:-0.39.1}"
CHROME_VERSION="${ODK_CHROME_VERSION:-155.0.8059.79}"
CHROME_DIR="${BROWSERS_DIR}/chrome-${CHROME_VERSION}"
CHROME_BIN="${CHROME_DIR}/chrome"

# Chrome's documented Debian runtime set. The list is explicit because a fuzzy
# package search can resolve a library name to the wrong package; the ldd
# assertion below is what proves the set is sufficient.
CHROME_PACKAGES="libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
libgbm1 libasound2 libpango-1.0-0 libcairo2 libxshmfence1 libvulkan1 \
fonts-liberation"

if [ "$(uname -m)" != "aarch64" ]; then
  echo "agent-browser provisioning targets arm64 (CM5). Current arch: $(uname -m)." >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: provisioning writes ${INSTALL_DIR} and installs packages." >&2
  exit 1
fi

resolve_target_user() {
  local user="${SUDO_USER:-}"
  if [ -n "${user}" ] && id "${user}" >/dev/null 2>&1; then
    printf '%s\n' "${user}"
    return
  fi
  user="$(loginctl list-sessions --no-legend 2>/dev/null | awk '$2 >= 1000 { print $3; exit }')"
  if [ -n "${user}" ] && id "${user}" >/dev/null 2>&1; then
    printf '%s\n' "${user}"
    return
  fi
  getent passwd 1000 | cut -d: -f1
}

TARGET_USER="$(resolve_target_user)"
if [ -z "${TARGET_USER}" ] || ! id "${TARGET_USER}" >/dev/null 2>&1 || [ "$(id -u "${TARGET_USER}")" -eq 0 ]; then
  echo "Could not determine the kiosk user." >&2
  exit 1
fi
TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
TARGET_UID="$(id -u "${TARGET_USER}")"
TARGET_GID="$(id -g "${TARGET_USER}")"

run_as_target_user() {
  runuser -u "${TARGET_USER}" -- env \
    HOME="${TARGET_HOME}" USER="${TARGET_USER}" LOGNAME="${TARGET_USER}" \
    XDG_RUNTIME_DIR="/run/user/${TARGET_UID}" \
    AGENT_BROWSER_EXECUTABLE_PATH="${CHROME_BIN}" \
    AGENT_BROWSER_SESSION="${PROBE_SESSION}" \
    "$@"
}

# The CLI is an executable, so the deadline applies to the CLI process itself.
# `timeout` cannot run the shell function above: it needs an executable name.
run_cli_as_target_user() {
  runuser -u "${TARGET_USER}" -- env \
    HOME="${TARGET_HOME}" USER="${TARGET_USER}" LOGNAME="${TARGET_USER}" \
    XDG_RUNTIME_DIR="/run/user/${TARGET_UID}" \
    AGENT_BROWSER_EXECUTABLE_PATH="${CHROME_BIN}" \
    AGENT_BROWSER_SESSION="${PROBE_SESSION}" \
    timeout "${PROBE_TIMEOUT}" "${CLI_BIN}" "$@"
}

install_cli() {
  local destination="${INSTALL_DIR}/bin/agent-browser-${AGENT_BROWSER_VERSION}"
  if [ -x "${destination}" ]; then
    echo "== agent-browser ${AGENT_BROWSER_VERSION} already installed =="
  else
    echo "== installing agent-browser ${AGENT_BROWSER_VERSION} =="
    install -d -o root -g root -m 0755 "${INSTALL_DIR}/bin"
    # Download beside the destination so a failed transfer never leaves a
    # partial binary that a later run would treat as installed.
    local temporary="${destination}.partial"
    rm -f "${temporary}"
    curl -fsSL --retry 3 --connect-timeout 15 \
      -o "${temporary}" \
      "https://github.com/vercel-labs/agent-browser/releases/download/v${AGENT_BROWSER_VERSION}/agent-browser-linux-arm64"
    if [ ! -s "${temporary}" ]; then
      rm -f "${temporary}"
      echo "agent-browser download was empty; check access to github.com." >&2
      exit 1
    fi
    chmod 0755 "${temporary}"
    mv -f "${temporary}" "${destination}"
  fi
  ln -sfn "${destination}" "${CLI_BIN}"
  # The resident service resolves its commands from PATH, so the CLI is exposed
  # there as host infrastructure rather than reached by an absolute path that
  # every consumer would have to repeat.
  ln -sfn "${CLI_BIN}" "/usr/local/bin/agent-browser"
}

install_browser() {
  local marker="${CHROME_DIR}/.odk-chrome-version"
  if [ -f "${marker}" ] && [ "$(cat "${marker}")" = "${CHROME_VERSION}" ] && [ -x "${CHROME_BIN}" ]; then
    echo "== Chrome for Testing ${CHROME_VERSION} already installed =="
  else
    echo "== installing Chrome for Testing ${CHROME_VERSION} =="
    local work
    work="$(mktemp -d)"
    if ! curl -fsSL --retry 3 --connect-timeout 15 -o "${work}/chrome.zip" \
      "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux-arm64/chrome-linux-arm64.zip"; then
      rm -rf "${work}"
      echo "Chrome download failed; check access to storage.googleapis.com." >&2
      exit 1
    fi
    unzip -q -o "${work}/chrome.zip" -d "${work}/extracted"
    # The archive's top directory name follows the platform, so locate the
    # launcher instead of assuming it.
    local source_dir
    source_dir="$(dirname "$(find "${work}/extracted" -maxdepth 2 -type f -name chrome -print -quit)")"
    if [ -z "${source_dir}" ] || [ ! -x "${source_dir}/chrome" ]; then
      rm -rf "${work}"
      echo "Chrome archive did not contain a chrome launcher; refusing to continue." >&2
      exit 1
    fi
    rm -rf "${CHROME_DIR:?}"
    install -d -o root -g root -m 0755 "${CHROME_DIR}"
    cp -a "${source_dir}/." "${CHROME_DIR}/"
    printf '%s\n' "${CHROME_VERSION}" > "${marker}"
    rm -rf "${work}"
  fi
  chown -R root:root "${CHROME_DIR}"
  # The kiosk user runs the browser; root owns it. The launcher is not setuid:
  # the namespace sandbox is the intended mode, and a setuid root binary is a
  # larger privilege surface than this device needs.
  chmod -R a+rX,go-w "${CHROME_DIR}"
  chmod 0755 "${CHROME_BIN}"
  # A stable path so device configuration does not name a version that the next
  # provisioning run replaces.
  ln -sfn "${CHROME_BIN}" "${INSTALL_DIR}/chrome"
}

# A second pinned version left in place grows without bound on a device whose
# root filesystem has been near full. Remove the versions this script owns and
# is not currently using.
prune_other_browsers() {
  local directory
  for directory in "${BROWSERS_DIR}"/chrome-*; do
    if [ ! -d "${directory}" ] || [ "${directory}" = "${CHROME_DIR}" ]; then
      continue
    fi
    echo "== removing superseded browser $(basename "${directory}") =="
    rm -rf "${directory}"
  done
}

install_browser_dependencies() {
  echo "== installing the Chrome runtime packages =="
  # shellcheck disable=SC2086
  apt-get install -y ${CHROME_PACKAGES} >/dev/null
  echo "== asserting that Chrome resolves every shared library =="
  local missing
  missing="$(ldd "${CHROME_BIN}" 2>/dev/null | awk '/not found/ { print $1 }' | sort -u)"
  if [ -n "${missing}" ]; then
    echo "Chrome cannot resolve: $(tr '\n' ' ' <<< "${missing}")" >&2
    echo "Install the providing packages, then re-run this script." >&2
    exit 1
  fi
}

PROBE_DIR=""

probe_cleanup() {
  if [ -n "${PROBE_DIR}" ]; then
    run_cli_as_target_user close >/dev/null 2>&1 || true
    rm -rf "${PROBE_DIR}"
    PROBE_DIR=""
  fi
}

verify_interaction() {
  echo "== verifying a real headless interaction as ${TARGET_USER} =="
  # Create and write the fixture while its root-owned directory is private.
  # The target user receives read access only after all root writes finish.
  PROBE_DIR="$(mktemp -d /tmp/odk-agent-browser-probe.XXXXXX)"
  trap probe_cleanup EXIT
  local probe_page="${PROBE_DIR}/probe.html"
  cat > "${probe_page}" <<'EOF'
<!doctype html>
<html><body>
<h1>odk-agent-browser-probe</h1>
<button id="press" onclick="document.getElementById('outcome').textContent='PROBE_CLICKED'">Press</button>
<div id="outcome">PROBE_IDLE</div>
</body></html>
EOF
  chmod 0644 "${probe_page}"
  chmod 0755 "${PROBE_DIR}"

  local snapshot
  if ! snapshot="$(run_cli_as_target_user open "file://${probe_page}" 2>&1 \
    && run_cli_as_target_user snapshot -i 2>&1)"; then
    echo "The agent-browser probe could not open a local page." >&2
    echo "${snapshot}" >&2
    probe_cleanup
    exit 1
  fi
  if ! grep -q 'button "Press"' <<< "${snapshot}"; then
    echo "The probe page did not expose its button to the accessibility snapshot." >&2
    echo "${snapshot}" >&2
    probe_cleanup
    exit 1
  fi

  local reference
  # The snapshot prints `ref=e2`; a command takes the same reference as `@e2`.
  reference="$(sed -n 's/.*\[ref=\(e[0-9]*\)\].*/@\1/p' <<< "${snapshot}" | head -1)"
  if [ -z "${reference}" ]; then
    echo "The snapshot did not carry a usable element reference; the probe cannot click." >&2
    echo "${snapshot}" >&2
    probe_cleanup
    exit 1
  fi
  local outcome
  outcome="$(run_cli_as_target_user click "${reference}" >/dev/null 2>&1 \
    && run_cli_as_target_user get text "#outcome" 2>&1 || true)"
  probe_cleanup
  if ! grep -q 'PROBE_CLICKED' <<< "${outcome}"; then
    echo "The probe click did not change the page; the browser is not driving the page." >&2
    echo "observed: ${outcome}" >&2
    exit 1
  fi
  echo "verified: the CLI drove Chrome ${CHROME_VERSION} and changed the page"
}

if [ ! -x "${CLI_BIN}" ] || [ ! -x "${CHROME_BIN}" ]; then
  if [ "${1:-install}" = "verify" ]; then
    echo "agent-browser is not installed under ${INSTALL_DIR}; run the installer first." >&2
    exit 1
  fi
fi

if [ "${1:-install}" = "verify" ]; then
  verify_interaction
  exit 0
fi

apt-get install -y curl unzip ca-certificates >/dev/null
install_cli
install_browser
prune_other_browsers

# Chrome refuses its sandbox when the kernel denies unprivileged user
# namespaces. Report the capability instead of leaving an unexplained failure.
if [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 1)" = "0" ]; then
  echo "warning: this kernel denies unprivileged user namespaces; the browser needs --no-sandbox here." >&2
fi

install_browser_dependencies
verify_interaction
echo "agent-browser ${AGENT_BROWSER_VERSION} and Chrome ${CHROME_VERSION} are ready under ${INSTALL_DIR}."
