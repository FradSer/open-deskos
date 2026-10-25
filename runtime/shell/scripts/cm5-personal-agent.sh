#!/usr/bin/env bash
# Sourced by cm5-install.sh after resolving the kiosk user and release paths.

RELEASE_PRIVATE_EXCLUDES=(--exclude '.env*' --exclude '*.env' --exclude 'auth.json' --exclude '.pi')

copy_release_input() {
  run_as_target_user rsync -a "${RELEASE_PRIVATE_EXCLUDES[@]}" "$@"
}

prepare_personal_agent_release() {
  local version major minor
  version="$(run_as_target_user "${NODE_BIN}/node" --version)"
  if [[ ! "$version" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    echo "Personal Agent requires Node >=22.19.0; could not verify selected Node" >&2
    return 1
  fi
  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  if (( major < 22 || (major == 22 && minor < 19) )); then
    echo "Personal Agent requires Node >=22.19.0; selected ${version}. Upgrade Node before staging." >&2
    return 1
  fi
  local destination="${RELEASE_DIR}/integrations/personal-agent"
  run_as_target_user mkdir -p "${destination}"
  # Only deploy runtime inputs, never a developer's auth, state, or node_modules.
  for entry in package.json pnpm-lock.yaml src systemd; do
    copy_release_input "${PERSONAL_AGENT_SOURCE}/${entry}" "${destination}/"
  done
  (cd "${destination}" && run_as_target_user pnpm install --prod --frozen-lockfile --ignore-scripts)
}

# Resolve service aliases retained by older CM5 installs before enabling a unit.
# systemd accepts aliases for start and status, but refuses enable when the requested name is an alias.
enable_user_unit() {
  local alias="$1" unit_id
  shift
  unit_id="$(run_as_target_user systemctl --user show --property=Id --value "$alias")" || return 1
  case "${alias}:${unit_id}" in
    odk-personal-agent.service:odk-personal-agent.service|odk-personal-agent.service:open-deskos-personal-agent.service|\
    odk-link.service:odk-link.service|odk-link.service:open-deskos-desk-link.service|\
    odk-remote-bridge.service:odk-remote-bridge.service|odk-remote-bridge.service:open-deskos-remote-bridge.service|\
    odk-pi-tasks.service:odk-pi-tasks.service|odk-pi-tasks.service:open-deskos-pi-tasks.service) ;;
    *)
      echo "Could not resolve the canonical user unit for ${alias}" >&2
      return 1
      ;;
  esac
  run_as_target_user systemctl --user enable "$@" "$unit_id"
}

# The Personal Agent and Hosted Pi control are required components of the runtime, so their units are
# staged from the candidate release before activation: a staging failure fails the installation while
# the previous release is still the active one. Starting them is a separate step, because the unit
# must run the release that activation selects.
stage_personal_agent_service() {
  local agent_env="${TARGET_HOME}/.config/odk/perosnal-agent.env"
  if [ -f "$agent_env" ] && grep -qE '^[[:space:]]*ODK_PERSONAL_BOT_' "$agent_env"; then
    echo "Migrate retired Personal Agent settings to ODK_PERSONAL_AGENT_ in perosnal-agent.env before staging; use Pi for models and credentials." >&2
    return 1
  fi
  # Activation can restart an enabled candidate before start_required_services runs.
  # Require explicit preparation while the previous release is still selected.
  local previous
  for previous in odk-personal-bot.service open-deskos-personal-bot.service; do
    if run_as_target_user systemctl --user is-active --quiet "$previous" ||
       run_as_target_user systemctl --user is-enabled --quiet "$previous"; then
      echo "Stop and disable the previous Personal Agent unit (${previous}) before staging. Preserve its configuration and history for recovery." >&2
      return 1
    fi
  done
  local template="${RELEASE_DIR}/integrations/personal-agent"
  local install_dir="${RUNTIME_ROOT}/current/integrations/personal-agent"
  local unit_dir="${TARGET_HOME}/.config/systemd/user"
  local unit="${unit_dir}/odk-personal-agent.service"
  $SUDO apt-get install -y alsa-utils || return 1
  if getent group audio >/dev/null 2>&1; then
    $SUDO usermod -a -G audio "${TARGET_USER}" || return 1
  fi
  run_as_target_user mkdir -p "${unit_dir}" || return 1
  sed -e "s|__ODK_PERSONAL_AGENT_DIR__|${install_dir}|g" \
    -e "s|__ODK_NODE_BIN__|${NODE_BIN}|g" \
    "${template}/systemd/odk-personal-agent.service" > "${unit}" || return 1
  $SUDO chown "${TARGET_UID}:${TARGET_GID}" "${unit}" || return 1
  $SUDO chmod 0644 "${unit}" || return 1
  run_as_target_user systemctl --user daemon-reload || return 1
  enable_user_unit odk-personal-agent.service
}

# Stages the hosted Pi session service on the stable release symlink, so an operator never
# substitutes a dated releases/<id> path that the next update replaces and locks.
stage_task_host_service() {
  local template="${RELEASE_DIR}/integrations/personal-agent"
  local install_dir="${RUNTIME_ROOT}/current/integrations/personal-agent"
  local unit_dir="${TARGET_HOME}/.config/systemd/user"
  local unit="${unit_dir}/odk-pi-tasks.service"
  run_as_target_user mkdir -p "${unit_dir}" || return 1
  sed -e "s|__ODK_PERSONAL_AGENT_DIR__|${install_dir}|g" \
    -e "s|__ODK_NODE_BIN__|${NODE_BIN}|g" \
    "${template}/systemd/odk-pi-tasks.service" > "${unit}" || return 1
  $SUDO chown "${TARGET_UID}:${TARGET_GID}" "${unit}" || return 1
  $SUDO chmod 0644 "${unit}" || return 1
  local helper_dir="${TARGET_HOME}/.local/bin"
  local helper="${helper_dir}/odk-pi-task-control" prepared
  run_as_target_user mkdir -p "${helper_dir}" || return 1
  prepared="$(mktemp)" || return 1
  if ! sed -e "s|__ODK_PERSONAL_AGENT_DIR__|${install_dir}|g" \
    -e "s|__ODK_NODE_BIN__|${NODE_BIN}|g" \
    -e "s|__ODK_TASK_CONFIG__|${TARGET_HOME}/.config/odk/pi-tasks.json|g" \
    "${template}/systemd/pi-task-control.sh" > "${prepared}"; then
    rm -f -- "${prepared}"
    return 1
  fi
  chmod 0644 "${prepared}" || { rm -f -- "${prepared}"; return 1; }
  # Install as the owner: a user-controlled destination must never receive a privileged write.
  if ! run_as_target_user install -m 0700 -- "${prepared}" "${helper}"; then
    rm -f -- "${prepared}"
    return 1
  fi
  rm -f -- "${prepared}"
  run_as_target_user systemctl --user daemon-reload
}

# Stages the Open DeskOS Link listener from the candidate release. Its unit is templated like the two
# above, so the desk never runs a hand-written copy that drifts; starting it is the separate step,
# because a desk without a Control/Reporting token is a reporting-only desk and must stay one.
stage_odk_link_service() {
  local template="${RELEASE_DIR}/systemd/odk-link.service"
  local install_dir="${RUNTIME_ROOT}/current"
  local unit_dir="${TARGET_HOME}/.config/systemd/user"
  local unit="${unit_dir}/odk-link.service"
  [ -f "${template}" ] || return 0
  run_as_target_user mkdir -p "${unit_dir}" || return 1
  sed -e "s|__ODK_LINK_DIR__|${install_dir}|g" "${template}" > "${unit}" || return 1
  $SUDO chown "${TARGET_UID}:${TARGET_GID}" "${unit}" || return 1
  $SUDO chmod 0644 "${unit}" || return 1
  run_as_target_user systemctl --user daemon-reload || return 1
  enable_user_unit odk-link.service
}

# Runs after activation, so both services execute the release that is now active, and after a fresh
# installation, where the activation transaction never ran. Start is idempotent: an update that
# already restarted them through the transaction skips this without a second interruption.
start_required_services() {
  local config="${TARGET_HOME}/.config/odk/pi-tasks.json"
  if [ -f "${TARGET_HOME}/.config/systemd/user/odk-voice-agent.service" ]; then
    run_as_target_user systemctl --user disable --now odk-voice-agent.service || return 1
  fi
  # Stop the previous runtime before moving its private history. Keep its unit for recovery.
  local legacy
  for legacy in odk-personal-bot.service open-deskos-personal-bot.service; do
    if [ -e "${TARGET_HOME}/.config/systemd/user/$legacy" ] || [ -L "${TARGET_HOME}/.config/systemd/user/$legacy" ]; then
      run_as_target_user systemctl --user disable --now "$legacy" || return 1
    fi
  done
  run_as_target_user "${NODE_BIN}/node" "${RUNTIME_ROOT}/current/integrations/personal-agent/src/migrate-personal-agent.mjs" || return 1
  run_as_target_user systemctl --user start odk-personal-agent.service || return 1
  # Open DeskOS Link is a listener on the LAN, so it starts only when its own secret exists. Staged without
  # one it stays stopped rather than running unauthenticated.
  if [ -f "${TARGET_HOME}/.config/systemd/user/odk-link.service" ]; then
    if grep -qE '^(ODK_LINK_TOKEN|ODK_LINK_TOKEN_FILE)=' "${TARGET_HOME}/.config/odk/runtime.env" 2>/dev/null; then
      enable_user_unit odk-link.service --now
    else
      echo "Open DeskOS Link unit staged but not started: set ODK_LINK_TOKEN_FILE (preferred) or ODK_LINK_TOKEN in ${TARGET_HOME}/.config/odk/runtime.env, then run 'systemctl --user start odk-link.service'." >&2
    fi
  fi
  # The daemon refuses to start without its private configuration and the unit restarts on failure,
  # so a host that has not created one keeps the unit staged and stopped instead of crash-looping.
  if [ ! -f "${config}" ]; then
    echo "Managed Pi tasks staged but not enabled: create ${config}, then run 'systemctl --user enable --now odk-pi-tasks.service'." >&2
    return 0
  fi
  enable_user_unit odk-pi-tasks.service --now
}
