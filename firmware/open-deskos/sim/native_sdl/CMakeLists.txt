# open-deskos native SDL2 simulator: builds the SAME firmware lua_module_lvgl
# sources against SDL2 + host shims (sim_esp_compat.c), independent of
# ESP-IDF, PlatformIO, and Emscripten. Mirrors pulse-esp/sim/CMakeLists.txt
# and the web sim's source list.
#
# Build & run (no IDF/emsdk on this Mac — memory [[idf-toolchain-activate]]):
#   brew install sdl2 cmake
#   cmake -S firmware/open-deskos/sim/native_sdl -B firmware/open-deskos/sim/native_sdl/build
#   cmake --build firmware/open-deskos/sim/native_sdl/build -j
#   cd firmware/open-deskos/sim/native_sdl && ./build/open-deskos_sim
#
# Host-vs-target honesty (memory [[open-deskos-firmware-host-vs-idf-build]]):
# this passing != `idf.py build` passing; the sim shares lua_module_lvgl source
# but exercises the IO/PARTIAL render path, not the device's MIPI_DSI path.
cmake_minimum_required(VERSION 3.16)
project(open-deskos_native_sim C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

include(FetchContent)

# lv_conf.h lives here — set before LVGL's own CMake runs so it uses ours.
set(LV_CONF_PATH "${CMAKE_CURRENT_SOURCE_DIR}/lv_conf.h" CACHE FILEPATH "" FORCE)
set(LV_CONF_INCLUDE_SIMPLE ON CACHE BOOL "" FORCE)

# Must be set before FetchContent for LVGL to pick it up
add_definitions(-DLV_TINY_TTF_CACHE_GLYPH_CNT=4096)

FetchContent_Declare(
    lvgl
    GIT_REPOSITORY https://github.com/lvgl/lvgl.git
    GIT_TAG v9.5.0
    GIT_SHALLOW TRUE
    SOURCE_DIR /Users/FradSer/Developer/FradSer/pulse-esp/.pio/libdeps/simulator/lvgl
    SUBBUILD_DIR "${CMAKE_BINARY_DIR}/_deps/lvgl-subbuild"
)
FetchContent_Declare(
    lua
    URL https://www.lua.org/ftp/lua-5.4.8.tar.gz
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(lvgl lua)

find_package(SDL2 REQUIRED)
find_library(M_LIB m)

set(LUA_SRC_DIR ${lua_SOURCE_DIR}/src)
set(LUA_SOURCES
    ${LUA_SRC_DIR}/lapi.c
    ${LUA_SRC_DIR}/lcode.c
    ${LUA_SRC_DIR}/lctype.c
    ${LUA_SRC_DIR}/ldebug.c
    ${LUA_SRC_DIR}/ldo.c
    ${LUA_SRC_DIR}/ldump.c
    ${LUA_SRC_DIR}/lfunc.c
    ${LUA_SRC_DIR}/lgc.c
    ${LUA_SRC_DIR}/llex.c
    ${LUA_SRC_DIR}/lmem.c
    ${LUA_SRC_DIR}/lobject.c
    ${LUA_SRC_DIR}/lopcodes.c
    ${LUA_SRC_DIR}/lparser.c
    ${LUA_SRC_DIR}/lstate.c
    ${LUA_SRC_DIR}/lstring.c
    ${LUA_SRC_DIR}/ltable.c
    ${LUA_SRC_DIR}/ltm.c
    ${LUA_SRC_DIR}/lundump.c
    ${LUA_SRC_DIR}/lvm.c
    ${LUA_SRC_DIR}/lzio.c
    ${LUA_SRC_DIR}/lauxlib.c
    ${LUA_SRC_DIR}/lbaselib.c
    ${LUA_SRC_DIR}/lcorolib.c
    ${LUA_SRC_DIR}/ldblib.c
    ${LUA_SRC_DIR}/liolib.c
    ${LUA_SRC_DIR}/lmathlib.c
    ${LUA_SRC_DIR}/loadlib.c
    ${LUA_SRC_DIR}/loslib.c
    ${LUA_SRC_DIR}/lstrlib.c
    ${LUA_SRC_DIR}/ltablib.c
    ${LUA_SRC_DIR}/lutf8lib.c
    ${LUA_SRC_DIR}/linit.c
)

set(ODK_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")   # firmware/open-deskos
set(LVGL_MOD  "${ODK_ROOT}/components/lua_modules/lua_module_lvgl/src")
set(SVC_LLM   "${ODK_ROOT}/components/odk_svc_llm")
set(VENDOR    "${ODK_ROOT}/tests/host/vendor")

# vendored cJSON (same source the firmware's built-in json uses) — for svc_llm.
add_library(sim_cjson STATIC "${VENDOR}/cjson/cJSON.c")
target_include_directories(sim_cjson PUBLIC "${VENDOR}/cjson")

find_package(CURL REQUIRED)

add_executable(open-deskos_sim
    sim_main.c
    sdl_driver.c
    sim_esp_compat.c
    host_lua_modules.c
    host_llm.c
    sim_voice_ui.c
    ${SVC_LLM}/src/svc_llm.c
    ${LVGL_MOD}/lua_module_lvgl.c
    ${LVGL_MOD}/lua_lvgl_runtime.c
    ${LVGL_MOD}/lua_lvgl_core_widgets.c
    ${LVGL_MOD}/lua_lvgl_complex_widgets.c
    ${LVGL_MOD}/lua_lvgl_demos.c
    ${LVGL_MOD}/lua_lvgl_extra_widgets.c
    ${LVGL_MOD}/lua_lvgl_events.c
    ${LVGL_MOD}/lua_lvgl_font.c
    ${LVGL_MOD}/lua_lvgl_indev.c
    ${LVGL_MOD}/lua_lvgl_layout.c
    ${LVGL_MOD}/lua_lvgl_methods.c
    ${LVGL_MOD}/lua_lvgl_object.c
    ${LVGL_MOD}/lua_lvgl_parse.c
    ${LVGL_MOD}/lua_lvgl_style.c
    ${LVGL_MOD}/lua_lvgl_symbols.c
    ${LVGL_MOD}/lua_lvgl_value.c
    ${LUA_SOURCES}
)

target_include_directories(open-deskos_sim PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/compat
    ${SVC_LLM}/include
    # odk_err.h lives in the domain component (zero-dep pure header)
    ${ODK_ROOT}/components/odk_domain/include
    ${LVGL_MOD}
    ${lvgl_SOURCE_DIR}
    ${LUA_SRC_DIR}
    ${VENDOR}/cjson
)

# __EMSCRIPTEN__ is intentionally defined for lua_module_lvgl in the NATIVE sim:
# it makes lua_lvgl_runtime's process_events() drive lv_timer_handler, skips the
# xTaskCreatePinnedToCore path, and defaults the LVGL FS data_root to "/" — the
# exact contract the Emscripten web sim relies on, with zero Emscripten deps
# (lua_module_lvgl has no EM_ASM calls, only #ifdef __EMSCRIPTEN__ guards).
target_compile_definitions(open-deskos_sim PRIVATE
    LV_TINY_TTF_CACHE_GLYPH_CNT=4096
    __EMSCRIPTEN__
    LUA_USE_C89
    # Default LLM model for the sim's AI->Lua->UI link (overridable by -D).
    # qwen3.7-plus is non-reasoning-fast with thinking:disabled (~25s for a full
    # UI script vs glm-5.2 reasoning's 2-5 min). Override per-run via env
    # ODK_SIM_LLM_REASONING=1 to keep reasoning, and the model is fixed here.
    ODK_LLM_CHAT_MODEL="qwen3.7-plus"
)

target_link_libraries(open-deskos_sim PRIVATE
    lvgl
    sim_cjson
    ${CURL_LIBRARIES}
    SDL2::SDL2
    SDL2::SDL2main
    ${M_LIB}
)
