cmake_minimum_required(VERSION 3.16)

include("${CMAKE_SOURCE_DIR}/tools/cmake/esp_idf_patch.cmake")
include("${CMAKE_SOURCE_DIR}/tools/cmake/flash_partition_defaults.cmake")

# managed_components/ is gitignored — re-apply strncpy→snprintf fixes needed
# for CONFIG_COMPILER_OPTIMIZATION_PERF (-Werror=stringop-truncation).
find_program(EDGE_AGENT_PYTHON NAMES python3 python REQUIRED)
execute_process(
    COMMAND "${EDGE_AGENT_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_mcp_c_sdk_perf.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE EDGE_AGENT_MCP_PATCH_RC
)
if(NOT EDGE_AGENT_MCP_PATCH_RC EQUAL 0)
    message(WARNING "[edge_agent] mcp-c-sdk PERF patch script failed (rc=${EDGE_AGENT_MCP_PATCH_RC})")
endif()

# DPI ISR requires adapter bridge user_ctx in internal RAM (PSRAM calloc breaks the MIPI triple-buffer route).
execute_process(
    COMMAND "${EDGE_AGENT_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_esp_lvgl_adapter_internal_ctx.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE EDGE_AGENT_ADAPTER_PATCH_RC
)
if(NOT EDGE_AGENT_ADAPTER_PATCH_RC EQUAL 0)
    message(WARNING "[edge_agent] esp_lvgl_adapter internal-ctx patch failed (rc=${EDGE_AGENT_ADAPTER_PATCH_RC})")
endif()

# P4's PPA validates output buffers against the external-DMA cache alignment.
# Snapshot layers can legitimately use a different backing alignment, so make
# the adapter fall back to LVGL's software blender instead of aborting the UI.
execute_process(
    COMMAND "${EDGE_AGENT_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_esp_lvgl_adapter_ppa_alignment.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE EDGE_AGENT_ADAPTER_PPA_ALIGNMENT_PATCH_RC
)
if(NOT EDGE_AGENT_ADAPTER_PPA_ALIGNMENT_PATCH_RC EQUAL 0)
    message(WARNING "[edge_agent] esp_lvgl_adapter PPA alignment patch failed (rc=${EDGE_AGENT_ADAPTER_PPA_ALIGNMENT_PATCH_RC})")
endif()

# LVGL 9.5 built-in ESP-PPA invalidate_cache msyncs the PSRAM draw buffer
# without ESP_CACHE_MSYNC_FLAG_UNALIGNED, so every PPA op with a non-64B-aligned
# data_size fails to flush CPU writes -> stale-cache reads -> garbled frames
# during big redraws (launcher hero animation "jumping" to its end state).
execute_process(
    COMMAND "${EDGE_AGENT_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_lvgl_ppa_cache_unaligned.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE EDGE_AGENT_LVGL_PPA_PATCH_RC
)
if(NOT EDGE_AGENT_LVGL_PPA_PATCH_RC EQUAL 0)
    message(WARNING "[edge_agent] lvgl PPA cache-unaligned patch failed (rc=${EDGE_AGENT_LVGL_PPA_PATCH_RC})")
endif()

# ESP32-P4 PPA SRM has a hardware hang bug (DIG-734): a non-trivial DMA2D
# output block can stall the transaction forever. Espressif's temporary fix
# (managed_components/espressif__esp_lvgl_adapter/0001-bugfix-ppa-*.patch)
# always bypasses SRM's macroblock-order path. With LV_USE_PPA on, the first
# SRM op on a hanging geometry blocks the render task (task alive, no Guru) —
# the launcher stalls before "voice UI running". The patch file is never
# applied by anything; this scripts it against the IDF component itself.
execute_process(
    COMMAND "${EDGE_AGENT_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_esp_driver_ppa_dig734.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE EDGE_AGENT_DIG734_PATCH_RC
)
if(NOT EDGE_AGENT_DIG734_PATCH_RC EQUAL 0)
    message(WARNING "[edge_agent] esp_driver_ppa DIG-734 patch failed (rc=${EDGE_AGENT_DIG734_PATCH_RC})")
endif()

# bmgr regenerates gen_bmgr_codes/CMakeLists.txt each pass with only
# REQUIRES esp_board_manager; this board's setup_device.c needs the local
# display/touch components too, so patch the generated REQUIRES line.
execute_process(
    COMMAND "${EDGE_AGENT_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_gen_bmgr_requires.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE EDGE_AGENT_BMGR_REQ_PATCH_RC
)
if(NOT EDGE_AGENT_BMGR_REQ_PATCH_RC EQUAL 0)
    message(WARNING "[edge_agent] gen_bmgr REQUIRES patch failed (rc=${EDGE_AGENT_BMGR_REQ_PATCH_RC})")
endif()

# ThorVG (LVGL's SW vector backend for aiodi.svg_icon) compares a plain char
# to < 0, which -Werror=type-limits rejects on riscv32 where char is unsigned.
execute_process(
    COMMAND "${EDGE_AGENT_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_lvgl_thorvg_werror.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE EDGE_AGENT_LVGL_THORVG_PATCH_RC
)
if(NOT EDGE_AGENT_LVGL_THORVG_PATCH_RC EQUAL 0)
    message(WARNING "[edge_agent] lvgl ThorVG Werror patch failed (rc=${EDGE_AGENT_LVGL_THORVG_PATCH_RC})")
endif()

# ESP-NOW validator + its odk_domain dependency live in the repo-root
# components/ tree (shared with host tests); the IDF project needs them on
# the component search path to resolve odk_espnow_validator. Must precede
# project() — IDF resolves components during that call.
set(EXTRA_COMPONENT_DIRS
    "${CMAKE_CURRENT_LIST_DIR}/../../components/odk_domain"
    "${CMAKE_CURRENT_LIST_DIR}/../../components/odk_espnow_validator"
)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(edge_agent VERSION 0.1.0)

set(EDGE_AGENT_FATFS_IMAGE_ROOT "${CMAKE_SOURCE_DIR}/fatfs_image")
set(EDGE_AGENT_FATFS_SOURCE_ROOT "${EDGE_AGENT_FATFS_IMAGE_ROOT}/storage")
set(EDGE_AGENT_FATFS_BUILD_ROOT "${CMAKE_BINARY_DIR}/fatfs_image")
set(EDGE_AGENT_FATFS_SYSTEM_SOURCE_ROOT "${EDGE_AGENT_FATFS_IMAGE_ROOT}/system")
set(EDGE_AGENT_FATFS_SYSTEM_BUILD_ROOT "${CMAKE_BINARY_DIR}/system_fs_image")
set(EDGE_AGENT_FATFS_PREPARE_STAMP "${CMAKE_BINARY_DIR}/edge_agent_prepare_fatfs_image.stamp")
set(EDGE_AGENT_FATFS_SYSTEM_PREPARE_STAMP "${CMAKE_BINARY_DIR}/edge_agent_prepare_system_fs_image.stamp")
set(EDGE_AGENT_BOARD_GENERATED_CMAKELISTS "${CMAKE_SOURCE_DIR}/components/gen_bmgr_codes/CMakeLists.txt")

file(GLOB_RECURSE EDGE_AGENT_FATFS_SOURCE_FILES CONFIGURE_DEPENDS
    "${EDGE_AGENT_FATFS_SOURCE_ROOT}/*"
)

file(GLOB_RECURSE EDGE_AGENT_FATFS_SYSTEM_SOURCE_FILES CONFIGURE_DEPENDS
    "${EDGE_AGENT_FATFS_SYSTEM_SOURCE_ROOT}/*"
)
# CMake's GLOB skips dot-prefixed entries by default. Explicitly pull in
# /system/.recovery/** so edits to recovery seed files still trigger a rebuild.
file(GLOB_RECURSE EDGE_AGENT_FATFS_SYSTEM_HIDDEN_SOURCE_FILES CONFIGURE_DEPENDS
    "${EDGE_AGENT_FATFS_SYSTEM_SOURCE_ROOT}/.recovery/*"
)
list(APPEND EDGE_AGENT_FATFS_SYSTEM_SOURCE_FILES
    ${EDGE_AGENT_FATFS_SYSTEM_HIDDEN_SOURCE_FILES})

set(EDGE_AGENT_BOARD_FATFS_SYSTEM_COPY_COMMANDS "")
set(EDGE_AGENT_BOARD_FATFS_SOURCE_FILES "")

if(EXISTS "${EDGE_AGENT_BOARD_GENERATED_CMAKELISTS}")
    file(STRINGS "${EDGE_AGENT_BOARD_GENERATED_CMAKELISTS}" EDGE_AGENT_BOARD_PATH_LINE
        REGEX "^message\\(STATUS \"Board Path: .+\"\\)$"
    )

    if(EDGE_AGENT_BOARD_PATH_LINE)
        list(GET EDGE_AGENT_BOARD_PATH_LINE 0 EDGE_AGENT_BOARD_PATH_LINE)
        string(REGEX REPLACE
            "^message\\(STATUS \"Board Path: (.*)\"\\)$"
            "\\1"
            EDGE_AGENT_BOARD_PATH
            "${EDGE_AGENT_BOARD_PATH_LINE}"
        )

        set(EDGE_AGENT_BOARD_FATFS_SOURCE_ROOT "${EDGE_AGENT_BOARD_PATH}/fatfs_image")

        if(EXISTS "${EDGE_AGENT_BOARD_FATFS_SOURCE_ROOT}")
            file(GLOB_RECURSE EDGE_AGENT_BOARD_FATFS_SOURCE_FILES CONFIGURE_DEPENDS
                "${EDGE_AGENT_BOARD_FATFS_SOURCE_ROOT}/*"
            )

            list(APPEND EDGE_AGENT_BOARD_FATFS_SYSTEM_COPY_COMMANDS
                COMMAND ${CMAKE_COMMAND} -E copy_directory
                        "${EDGE_AGENT_BOARD_FATFS_SOURCE_ROOT}"
                        "${EDGE_AGENT_FATFS_SYSTEM_BUILD_ROOT}"
            )
        endif()
    endif()
endif()

add_custom_command(
    OUTPUT "${EDGE_AGENT_FATFS_PREPARE_STAMP}"
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${EDGE_AGENT_FATFS_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E make_directory "${EDGE_AGENT_FATFS_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${EDGE_AGENT_FATFS_SOURCE_ROOT}"
            "${EDGE_AGENT_FATFS_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E touch "${EDGE_AGENT_FATFS_PREPARE_STAMP}"
    DEPENDS ${EDGE_AGENT_FATFS_SOURCE_FILES}
    VERBATIM
)

add_custom_target(edge_agent_prepare_fatfs_image
    DEPENDS "${EDGE_AGENT_FATFS_PREPARE_STAMP}"
)

# Prepare the read-only system partition build tree: mirror the source
# system_fs_image/ into a build-side staging dir that skill/lua syncs
# can also write into before fatfsgen packs it.
add_custom_command(
    OUTPUT "${EDGE_AGENT_FATFS_SYSTEM_PREPARE_STAMP}"
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${EDGE_AGENT_FATFS_SYSTEM_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E make_directory "${EDGE_AGENT_FATFS_SYSTEM_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${EDGE_AGENT_FATFS_SYSTEM_SOURCE_ROOT}"
            "${EDGE_AGENT_FATFS_SYSTEM_BUILD_ROOT}"
    ${EDGE_AGENT_BOARD_FATFS_SYSTEM_COPY_COMMANDS}
    COMMAND ${CMAKE_COMMAND} -E touch "${EDGE_AGENT_FATFS_SYSTEM_PREPARE_STAMP}"
    DEPENDS ${EDGE_AGENT_FATFS_SYSTEM_SOURCE_FILES} ${EDGE_AGENT_BOARD_FATFS_SOURCE_FILES}
    VERBATIM
)

add_custom_target(edge_agent_prepare_system_fs_image
    DEPENDS "${EDGE_AGENT_FATFS_SYSTEM_PREPARE_STAMP}"
)

fatfs_create_rawflash_image(system "${EDGE_AGENT_FATFS_SYSTEM_BUILD_ROOT}" FLASH_IN_PROJECT)
fatfs_create_spiflash_image(storage "${EDGE_AGENT_FATFS_BUILD_ROOT}" FLASH_IN_PROJECT)

# Skill / Lua resources are now baked into the read-only system partition
# so storage can be reformatted at runtime without losing them.
skill_builder_configure_skill_sync(
    TARGET fatfs_system_bin
    SKILL_OUTPUT_DIR "${EDGE_AGENT_FATFS_SYSTEM_BUILD_ROOT}/skills"
)

lua_module_builder_configure_builtin_lua_sync(
    TARGET fatfs_system_bin
    BUILTIN_OUTPUT_DIR "${EDGE_AGENT_FATFS_SYSTEM_BUILD_ROOT}/scripts/builtin"
    DOCS_OUTPUT_DIR "${EDGE_AGENT_FATFS_SYSTEM_BUILD_ROOT}/scripts/docs"
)

add_dependencies(skill_builder_sync_skills edge_agent_prepare_system_fs_image)
add_dependencies(lua_module_builder_sync_builtin_scripts edge_agent_prepare_system_fs_image)
add_dependencies(lua_module_builder_sync_docs edge_agent_prepare_system_fs_image)
add_dependencies(fatfs_system_bin edge_agent_prepare_system_fs_image)
add_dependencies(fatfs_storage_bin edge_agent_prepare_fatfs_image)

add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/skill_builder_sync.stamp"
    APPEND
    DEPENDS "${EDGE_AGENT_FATFS_SYSTEM_PREPARE_STAMP}"
)

add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/lua_module_builder_builtin_scripts_sync.stamp"
    APPEND
    DEPENDS "${EDGE_AGENT_FATFS_SYSTEM_PREPARE_STAMP}"
)

add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/lua_module_builder_docs_sync.stamp"
    APPEND
    DEPENDS "${EDGE_AGENT_FATFS_SYSTEM_PREPARE_STAMP}"
)
