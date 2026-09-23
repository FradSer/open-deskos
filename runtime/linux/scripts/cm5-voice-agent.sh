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

# The Voice Agent and Hosted Pi control are required components of the runtime, so their units are
# staged from the candidate release before activation: a staging failure fails the installation while
# the previous release is still the active one. Starting them is a separate step, because the unit
# must run the release that activation selects.
stage_voice_agent_service() {
  local template="${RELEASE_DIR}/integrations/voice-agent"
  local install_dir="${RUNTIME_ROOT}/current/integrations/voice-agent"
  local unit_dir="${TARGET_HOME}/.config/systemd/user"
  local unit="${unit_dir}/open-deskos-voice-agent.service"
  $SUDO apt-get install -y alsa-utils || return 1
  if getent group audio >/dev/null 2>&1; then
    $SUDO usermod -a -G audio "${TARGET_USER}" || return 1
  fi
  run_as_target_user mkdir -p "${unit_dir}" || return 1
  sed -e "s|__OPEN_DESKOS_VOICE_AGENT_DIR__|${install_dir}|g" \
    -e "s|__OPEN_DESKOS_NODE_BIN__|${NODE_BIN}|g" \
    "${template}/systemd/open-deskos-voice-agent.service" > "${unit}" || return 1
  $SUDO chown "${TARGET_UID}:${TARGET_GID}" "${unit}" || return 1
  $SUDO chmod 0644 "${unit}" || return 1
  run_as_target_user systemctl --user daemon-reload || return 1
  run_as_target_user systemctl --user enable open-deskos-voice-agent.service
}

# Stages the hosted Pi session service on the stable release symlink, so an operator never
# substitutes a dated releases/<id> path that the next update replaces and locks.
stage_task_host_service() {
  local template="${RELEASE_DIR}/integrations/voice-agent"
  local install_dir="${RUNTIME_ROOT}/current/integrations/voice-agent"
  local unit_dir="${TARGET_HOME}/.config/systemd/user"
  local unit="${unit_dir}/open-deskos-pi-tasks.service"
  run_as_target_user mkdir -p "${unit_dir}" || return 1
  sed -e "s|__OPEN_DESKOS_VOICE_AGENT_DIR__|${install_dir}|g" \
    -e "s|__OPEN_DESKOS_NODE_BIN__|${NODE_BIN}|g" \
    "${template}/systemd/open-deskos-pi-tasks.service" > "${unit}" || return 1
  $SUDO chown "${TARGET_UID}:${TARGET_GID}" "${unit}" || return 1
  $SUDO chmod 0644 "${unit}" || return 1
  run_as_target_user systemctl --user daemon-reload
}

# Stages the Desk Link listener from the candidate release. Its unit is templated like the two
# above, so the desk never runs a hand-written copy that drifts; starting it is the separate step,
# because a desk without a Control/Reporting token is a reporting-only desk and must stay one.
stage_desk_link_service() {
  local template="${RELEASE_DIR}/systemd/open-deskos-desk-link.service"
  local install_dir="${RUNTIME_ROOT}/current"
  local unit_dir="${TARGET_HOME}/.config/systemd/user"
  local unit="${unit_dir}/open-deskos-desk-link.service"
  [ -f "${template}" ] || return 0
  run_as_target_user mkdir -p "${unit_dir}" || return 1
  sed -e "s|__OPEN_DESKOS_DESK_LINK_DIR__|${install_dir}|g" "${template}" > "${unit}" || return 1
  $SUDO chown "${TARGET_UID}:${TARGET_GID}" "${unit}" || return 1
  $SUDO chmod 0644 "${unit}" || return 1
  run_as_target_user systemctl --user daemon-reload || return 1
  run_as_target_user systemctl --user enable open-deskos-desk-link.service
}

# Runs after activation, so both services execute the release that is now active, and after a fresh
# installation, where the activation transaction never ran. Start is idempotent: an update that
# already restarted them through the transaction skips this without a second interruption.
start_required_services() {
  local config="${TARGET_HOME}/.config/open-deskos/pi-tasks.json"
  run_as_target_user systemctl --user start open-deskos-voice-agent.service || return 1
  # Desk Link is a listener on the LAN, so it starts only when its own secret exists. Staged without
  # one it stays stopped rather than running unauthenticated.
  if [ -f "${TARGET_HOME}/.config/systemd/user/open-deskos-desk-link.service" ]; then
    if grep -q '^ODK_DESK_LINK_TOKEN=' "${TARGET_HOME}/.config/open-deskos/runtime.env" 2>/dev/null; then
      run_as_target_user systemctl --user enable --now open-deskos-desk-link.service
    else
      echo "Desk Link unit staged but not enabled: set ODK_DESK_LINK_TOKEN in ${TARGET_HOME}/.config/open-deskos/runtime.env, then run 'systemctl --user enable --now open-deskos-desk-link.service'." >&2
    fi
  fi
  # The daemon refuses to start without its private configuration and the unit restarts on failure,
  # so a host that has not created one keeps the unit staged and stopped instead of crash-looping.
  if [ ! -f "${config}" ]; then
    echo "Managed Pi tasks staged but not enabled: create ${config}, then run 'systemctl --user enable --now open-deskos-pi-tasks.service'." >&2
    return 0
  fi
  run_as_target_user systemctl --user enable --now open-deskos-pi-tasks.service
}
