#!/usr/bin/env bash
# shellcheck disable=SC3040
set -euo pipefail

readonly SIM_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly ODK_ROOT="$(CDPATH= cd -- "${SIM_DIR}/../.." && pwd -P)"
readonly BUILD_DIR="${SIM_DIR}/build"
readonly FONT_DIR="${ODK_ROOT}/application/edge_agent/fatfs_image/storage/fonts"
readonly LUA_SOURCE="${ODK_ROOT}/components/lua_modules/lua_module_lvgl/lib"

if ! command -v cmake >/dev/null 2>&1; then
    echo "error: cmake is required; install it with 'brew install cmake'" >&2
    exit 1
fi

for font in NotoSansSC-Regular.ttf Montserrat-Bold.ttf CJKalmanac.ttf fa-icons.ttf; do
    if [[ ! -f "${FONT_DIR}/${font}" ]]; then
        echo "error: simulator font not found: ${FONT_DIR}/${font}" >&2
        exit 1
    fi
done

if [[ ! -f "${LUA_SOURCE}/launcher.lua" ]]; then
    echo "error: simulator Lua assets not found: ${LUA_SOURCE}" >&2
    exit 1
fi

# These runtime files are intentionally ignored by Git; keep them in sync with
# the firmware sources before launching the host simulator.
mkdir -p "${SIM_DIR}/fonts" "${SIM_DIR}/lib"
cp "${FONT_DIR}/NotoSansSC-Regular.ttf" "${SIM_DIR}/fonts/NotoSansSC-Regular.ttf"
cp "${FONT_DIR}/Montserrat-Bold.ttf" "${SIM_DIR}/fonts/Montserrat-Bold.ttf"
cp "${FONT_DIR}/CJKalmanac.ttf" "${SIM_DIR}/fonts/CJKalmanac.ttf"
cp "${FONT_DIR}/fa-icons.ttf" "${SIM_DIR}/fonts/fa-icons.ttf"
cp -R "${LUA_SOURCE}/." "${SIM_DIR}/lib/"

cmake -S "${SIM_DIR}" -B "${BUILD_DIR}"

# Limit parallel build jobs to avoid freezing the VM on constrained hosts.
# Use half of available CPUs (min 2) — enough for fast builds without
# starving the rest of the system.
_nproc() { nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4; }
NPROC="$(_nproc)"
if [ "$NPROC" -le 2 ]; then
    PARALLEL_JOBS="$NPROC"
else
    PARALLEL_JOBS=$((NPROC / 2))
fi
readonly NPROC PARALLEL_JOBS
cmake --build "${BUILD_DIR}" --parallel "${PARALLEL_JOBS}"

CDPATH= cd -- "${SIM_DIR}"

# When ODK_SIM_SHOT is set, always use SDL_VIDEODRIVER=dummy regardless of
# display availability — this is the primary headless screenshot path.
if [ -n "${ODK_SIM_SHOT:-}" ]; then
    export SDL_VIDEODRIVER=dummy
    echo "[run.sh] headless: ODK_SIM_SHOT set, using SDL_VIDEODRIVER=dummy" >&2
else
    # Interactive mode: verify a real display server is available.
    # DISPLAY set but no X11 socket → X server not running → SDL blocks forever.
    if [ -n "${DISPLAY:-}" ]; then
        _x11_socket="/tmp/.X11-unix/X${DISPLAY#*:}"
        if [ ! -S "$_x11_socket" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
            echo "warning: DISPLAY=${DISPLAY} but X11 socket ${_x11_socket} not found" >&2
            echo "  The X server is not running despite DISPLAY being set." >&2
            echo "  Set ODK_SIM_SHOT=<path> for headless screenshot mode." >&2
            exit 1
        fi
    elif [ "$(uname -s)" != "Darwin" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
        # Linux needs X11 or Wayland; macOS uses SDL's native Cocoa backend.
        echo "warning: no display server found (DISPLAY unset), simulator cannot open a window" >&2
        echo "  Set ODK_SIM_SHOT=<path> for headless screenshot mode." >&2
        echo "  Set DISPLAY=:0 or run in a desktop session for interactive mode." >&2
        exit 1
    fi
fi

exec "${BUILD_DIR}/open-deskos_sim" "$@"
