cmake_minimum_required(VERSION 3.16)
project(odk_host_tests C)

# Platform-slice host test harness: plain CMake + Unity + vendored Lua/cJSON,
# with zero embedded-firmware-toolchain dependency. It references no firmware
# toolchain path variable and includes no firmware SDK headers, so these tests
# build and run on a clean macOS/Linux host with the firmware toolchain inactive.

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

enable_testing()

set(VENDOR_DIR "${CMAKE_CURRENT_SOURCE_DIR}/vendor")

# --- vendored Lua (georgik/lua 5.5.0~7, byte-aligned with the on-target VM) ---
# Compile the same library translation units the on-target component compiles.
# Exclude the standalone interpreter (lua.c has main()), the single-file
# amalgamation (onelua.c, would duplicate every symbol), and the internal test
# harness (ltests.c, needs LUA_USER_H instrumentation defines).
file(GLOB LUA_ALL_SRCS "${VENDOR_DIR}/lua/lua/*.c")
list(FILTER LUA_ALL_SRCS EXCLUDE REGEX "/(lua|onelua|ltests)\\.c$")
add_library(vendored_lua STATIC ${LUA_ALL_SRCS})
target_include_directories(vendored_lua PUBLIC
    "${VENDOR_DIR}/lua/lua"
    "${VENDOR_DIR}/lua/include")
# The vendored luaconf.h reads LUAI_MAXSTACK from CONFIG_LUA_MAXSTACK, which the
# firmware build supplies from sdkconfig. Supply the identical value the target
# resolves (the georgik Kconfig default, 1000000) so the host VM is configured
# exactly like the on-target VM, not merely built from the same source.
target_compile_definitions(vendored_lua PUBLIC CONFIG_LUA_MAXSTACK=1000000)
# libm for Lua's math library; harmless (part of libSystem) on macOS.
find_library(M_LIB m)
if(M_LIB)
    target_link_libraries(vendored_lua PUBLIC ${M_LIB})
endif()

# --- vendored Unity (ThrowTheSwitch 2.6.0) ---
add_library(vendored_unity STATIC "${VENDOR_DIR}/unity/unity.c")
target_include_directories(vendored_unity PUBLIC "${VENDOR_DIR}/unity")

# The GT911 sampler queue is deliberately host-independent so its ordering
# contract can be tested without ESP-IDF, LVGL, or a physical touch panel.
add_library(lua_lvgl_touch_sample_queue STATIC
    "${CMAKE_CURRENT_SOURCE_DIR}/../../components/lua_modules/lua_module_lvgl/src/lua_lvgl_touch_sample_queue.c")
target_include_directories(lua_lvgl_touch_sample_queue PUBLIC
    "${CMAKE_CURRENT_SOURCE_DIR}/../../components/lua_modules/lua_module_lvgl/src")

# --- vendored cJSON (1.7.18, same source as the firmware's built-in json) ---
add_library(vendored_cjson STATIC "${VENDOR_DIR}/cjson/cJSON.c")
target_include_directories(vendored_cjson PUBLIC "${VENDOR_DIR}/cjson")

# --- Open DeskOS components under test (odk_domain, odk_sandbox, odk_svc_llm, ...) ---
# Globs every components/odk_*/src/*.c into one static library and every
# components/odk_*/include directory into its public include path, so a
# sibling test task that adds its own odk_* component needs zero edits here.
file(GLOB ODK_COMPONENT_SRCS CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/../../components/odk_*/src/*.c")
file(GLOB ODK_COMPONENT_INCLUDE_DIRS CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/../../components/odk_*/include")

if(ODK_COMPONENT_SRCS)
    add_library(odk_under_test STATIC ${ODK_COMPONENT_SRCS})
    target_include_directories(odk_under_test PUBLIC ${ODK_COMPONENT_INCLUDE_DIRS})
    target_link_libraries(odk_under_test PUBLIC vendored_cjson vendored_lua)
else()
    # No odk_* component has sources yet (header-only stage): keep the
    # target linkable so the build still configures cleanly.
    add_library(odk_under_test INTERFACE)
    target_include_directories(odk_under_test INTERFACE ${ODK_COMPONENT_INCLUDE_DIRS})
    target_link_libraries(odk_under_test INTERFACE vendored_cjson vendored_lua)
endif()

# --- fakes (test doubles for ports injected into odk_svc_llm and future
# batches' components) ---
# Globs every tests/host/fakes/*.c into one static library with fakes/ on its
# public include path, so a sibling test task that adds its own fake needs
# zero edits here.
file(GLOB FAKE_SRCS CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/fakes/*.c")
if(FAKE_SRCS)
    add_library(odk_fakes STATIC ${FAKE_SRCS})
    target_include_directories(odk_fakes PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/fakes")
    target_link_libraries(odk_fakes PUBLIC odk_under_test)
else()
    # No fake has sources yet: keep the target linkable so the build still
    # configures cleanly.
    add_library(odk_fakes INTERFACE)
    target_include_directories(odk_fakes INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/fakes")
endif()

# --- auto-register every test_*.c as its own ctest case ---
# Adding a new test_*.c file needs no edit here: it is picked up on the next
# CMake configure and registered automatically.
file(GLOB TEST_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/test_*.c")
foreach(test_src ${TEST_SOURCES})
    get_filename_component(test_name "${test_src}" NAME_WE)
    add_executable("${test_name}" "${test_src}")
    target_include_directories("${test_name}" PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}")
    target_link_libraries("${test_name}" PRIVATE
        odk_under_test odk_fakes vendored_unity vendored_lua vendored_cjson
        lua_lvgl_touch_sample_queue)
    add_test(NAME "${test_name}" COMMAND "${test_name}")
endforeach()

# --- AIODI token drift guard (single-source check; see tools/aiodi_tokens.lua) ---
# Runs the generator's --check mode so palette drift between aiodi.lua (the one
# source of truth) and its consumers (odk_voice_ui.c, sim_voice_ui.c) fails the
# host test suite instead of shipping silently. Skipped on hosts with no lua.
find_program(HOST_LUA lua)
if(HOST_LUA)
    add_test(NAME aiodi_tokens_check
        COMMAND ${HOST_LUA}
                "${CMAKE_CURRENT_SOURCE_DIR}/../../tools/aiodi_tokens.lua" --check)
endif()

# Direct shell boot may open luaopen_lvgl even when app_claw startup is
# unavailable. Keep the DATA-root bootstrap ahead of that direct open so
# runtime TTF paths cannot regress to an unconfigured D: driver.
add_test(NAME lvgl_font_bootstrap_contract
    COMMAND ${CMAKE_COMMAND}
            -D ODK_ROOT=${CMAKE_CURRENT_SOURCE_DIR}/../..
            -P "${CMAKE_CURRENT_SOURCE_DIR}/font_bootstrap_contract.cmake")


add_test(NAME home_pager_contract
    COMMAND ${CMAKE_COMMAND}
            -D ODK_ROOT=${CMAKE_CURRENT_SOURCE_DIR}/../..
            -P "${CMAKE_CURRENT_SOURCE_DIR}/home_pager_contract.cmake")

add_test(NAME ui_polish_contract
    COMMAND ${CMAKE_COMMAND}
            -D ODK_ROOT=${CMAKE_CURRENT_SOURCE_DIR}/../..
            -P "${CMAKE_CURRENT_SOURCE_DIR}/ui_polish_contract.cmake")

add_test(NAME dashboard_layout_contract
    COMMAND ${CMAKE_COMMAND}
            -D ODK_ROOT=${CMAKE_CURRENT_SOURCE_DIR}/../..
            -P "${CMAKE_CURRENT_SOURCE_DIR}/dashboard_layout_contract.cmake")

# The object-level Dashboard harness instantiates the same LVGL labels as the
# launcher, reads their actual frames, and checks baseline / adaptive-plan
# behavior. Keep it in CTest rather than relying on a static source contract.
add_test(NAME dashboard_layout_harness
    COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/../../sim/native_sdl/run.sh
            @${CMAKE_CURRENT_SOURCE_DIR}/dashboard_layout_harness.lua)
set_tests_properties(dashboard_layout_harness PROPERTIES
    ENVIRONMENT "ODK_SIM_SHOT=/tmp/open-deskos-dashboard-layout-harness.bmp;ODK_SIM_SHOT_FRAMES=10")

add_test(NAME ppa_adapter_alignment_contract
    COMMAND ${CMAKE_COMMAND}
            -D ODK_ROOT=${CMAKE_CURRENT_SOURCE_DIR}/../..
            -P "${CMAKE_CURRENT_SOURCE_DIR}/ppa_adapter_alignment_contract.cmake")

add_test(NAME firmware_scope_contract
    COMMAND ${CMAKE_COMMAND}
            -D ODK_ROOT=${CMAKE_CURRENT_SOURCE_DIR}/../..
            -P "${CMAKE_CURRENT_SOURCE_DIR}/firmware_scope_contract.cmake")
