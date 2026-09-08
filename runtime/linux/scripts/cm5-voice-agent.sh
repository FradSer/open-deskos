#!/usr/bin/env bash
# Sourced by cm5-install.sh after resolving the kiosk user and release paths.

prepare_voice_agent_release() {
  local version major minor
  version="$(run_as_target_user "${NODE_BIN}/node" --version)"
  if [[ ! "$version" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    echo "Voice agent requires Node >=22.19.0; could not verify selected Node" >&2
    return 1
  fi
  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  if (( major < 22 || (major == 22 && minor < 19) )); then
    echo "Voice agent requires Node >=22.19.0; selected ${version}. Upgrade Node before staging." >&2
    return 1
  fi
  local destination="${RELEASE_DIR}/integrations/voice-agent"
  run_as_target_user mkdir -p "${destination}"
  # Only deploy runtime inputs, never a developer's auth, state, or node_modules.
  for entry in package.json pnpm-lock.yaml src systemd; do
    run_as_target_user cp -a "${VOICE_AGENT_SOURCE}/${entry}" "${destination}/"
  done
  (cd "${destination}" && run_as_target_user pnpm install --prod --frozen-lockfile --ignore-scripts)
}

install_voice_agent_service() {
  local source="${RUNTIME_ROOT}/current/integrations/voice-agent"
  local unit_dir="${TARGET_HOME}/.config/systemd/user"
  local unit="${unit_dir}/open-deskos-voice-agent.service"
  $SUDO apt-get install -y alsa-utils || return 1
  if getent group audio >/dev/null 2>&1; then
    $SUDO usermod -a -G audio "${TARGET_USER}" || return 1
  fi
  run_as_target_user mkdir -p "${unit_dir}" || return 1
  sed -e "s|__OPEN_DESKOS_VOICE_AGENT_DIR__|${source}|g" \
    -e "s|__OPEN_DESKOS_NODE_BIN__|${NODE_BIN}|g" \
    "${source}/systemd/open-deskos-voice-agent.service" > "${unit}" || return 1
  $SUDO chown "${TARGET_UID}:${TARGET_GID}" "${unit}" || return 1
  $SUDO chmod 0644 "${unit}" || return 1
  run_as_target_user systemctl --user daemon-reload || return 1
  run_as_target_user systemctl --user enable open-deskos-voice-agent.service || return 1
  run_as_target_user systemctl --user restart open-deskos-voice-agent.service
}
