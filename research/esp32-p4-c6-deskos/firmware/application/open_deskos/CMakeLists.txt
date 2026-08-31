cmake_minimum_required(VERSION 3.16)

include("${CMAKE_SOURCE_DIR}/tools/cmake/esp_idf_patch.cmake")
include("${CMAKE_SOURCE_DIR}/tools/cmake/flash_partition_defaults.cmake")

# managed_components/ is gitignored — re-apply strncpy→snprintf fixes needed
# for CONFIG_COMPILER_OPTIMIZATION_PERF (-Werror=stringop-truncation).
find_program(OPEN_DESKOS_PYTHON NAMES python3 python REQUIRED)
execute_process(
    COMMAND "${OPEN_DESKOS_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_mcp_c_sdk_perf.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE OPEN_DESKOS_MCP_PATCH_RC
)
if(NOT OPEN_DESKOS_MCP_PATCH_RC EQUAL 0)
    message(WARNING "[open_deskos] mcp-c-sdk PERF patch script failed (rc=${OPEN_DESKOS_MCP_PATCH_RC})")
endif()

# DPI ISR requires adapter bridge user_ctx in internal RAM (PSRAM calloc breaks the MIPI triple-buffer route).
execute_process(
    COMMAND "${OPEN_DESKOS_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_esp_lvgl_adapter_internal_ctx.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE OPEN_DESKOS_ADAPTER_PATCH_RC
)
if(NOT OPEN_DESKOS_ADAPTER_PATCH_RC EQUAL 0)
    message(WARNING "[open_deskos] esp_lvgl_adapter internal-ctx patch failed (rc=${OPEN_DESKOS_ADAPTER_PATCH_RC})")
endif()

# The production board catalog includes the P4 and compact S3 targets. The S3
# uses the SPI path and must not run P4-only adapter patching assumptions.

# P4's PPA validates output buffers against the external-DMA cache alignment.
if(NOT IDF_TARGET STREQUAL "esp32s3")
# Snapshot layers can legitimately use a different backing alignment, so make
# the adapter fall back to LVGL's software blender instead of aborting the UI.
execute_process(
    COMMAND "${OPEN_DESKOS_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_esp_lvgl_adapter_ppa_alignment.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE OPEN_DESKOS_ADAPTER_PPA_ALIGNMENT_PATCH_RC
)
if(NOT OPEN_DESKOS_ADAPTER_PPA_ALIGNMENT_PATCH_RC EQUAL 0)
    message(WARNING "[open_deskos] esp_lvgl_adapter PPA alignment patch failed (rc=${OPEN_DESKOS_ADAPTER_PPA_ALIGNMENT_PATCH_RC})")
endif()

# LVGL 9.5 built-in ESP-PPA invalidate_cache msyncs the PSRAM draw buffer
# without ESP_CACHE_MSYNC_FLAG_UNALIGNED, so every PPA op with a non-64B-aligned
# data_size fails to flush CPU writes -> stale-cache reads -> garbled frames
# during big redraws (launcher hero animation "jumping" to its end state).
execute_process(
    COMMAND "${OPEN_DESKOS_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_lvgl_ppa_cache_unaligned.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE OPEN_DESKOS_LVGL_PPA_PATCH_RC
)
if(NOT OPEN_DESKOS_LVGL_PPA_PATCH_RC EQUAL 0)
    message(WARNING "[open_deskos] lvgl PPA cache-unaligned patch failed (rc=${OPEN_DESKOS_LVGL_PPA_PATCH_RC})")
endif()

# ESP32-P4 PPA SRM has a hardware hang bug (DIG-734): a non-trivial DMA2D
# output block can stall the transaction forever. Espressif's temporary fix
# (managed_components/espressif__esp_lvgl_adapter/0001-bugfix-ppa-*.patch)
# always bypasses SRM's macroblock-order path. With LV_USE_PPA on, the first
# SRM op on a hanging geometry blocks the render task (task alive, no Guru) —
# the launcher stalls before "voice UI running". The patch file is never
# applied by anything; this scripts it against the IDF component itself.
execute_process(
    COMMAND "${OPEN_DESKOS_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_esp_driver_ppa_dig734.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE OPEN_DESKOS_DIG734_PATCH_RC
)
if(NOT OPEN_DESKOS_DIG734_PATCH_RC EQUAL 0)
    message(WARNING "[open_deskos] esp_driver_ppa DIG-734 patch failed (rc=${OPEN_DESKOS_DIG734_PATCH_RC})")
endif()

# bmgr regenerates gen_bmgr_codes/CMakeLists.txt each pass with only
# REQUIRES esp_board_manager; this board's setup_device.c needs the local
# display/touch components too, so patch the generated REQUIRES line.
execute_process(
    COMMAND "${OPEN_DESKOS_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_gen_bmgr_requires.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE OPEN_DESKOS_BMGR_REQ_PATCH_RC
)
if(NOT OPEN_DESKOS_BMGR_REQ_PATCH_RC EQUAL 0)
    message(WARNING "[open_deskos] gen_bmgr REQUIRES patch failed (rc=${OPEN_DESKOS_BMGR_REQ_PATCH_RC})")
endif()

endif()

# ThorVG (LVGL's SW vector backend for aiodi.svg_icon) compares a plain char
# to < 0, which -Werror=type-limits rejects on riscv32 where char is unsigned.
execute_process(
    COMMAND "${OPEN_DESKOS_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_lvgl_thorvg_werror.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE OPEN_DESKOS_LVGL_THORVG_PATCH_RC
)
if(NOT OPEN_DESKOS_LVGL_THORVG_PATCH_RC EQUAL 0)
    message(WARNING "[open_deskos] lvgl ThorVG Werror patch failed (rc=${OPEN_DESKOS_LVGL_THORVG_PATCH_RC})")
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
project(open_deskos VERSION 0.1.0)

set(OPEN_DESKOS_FATFS_IMAGE_ROOT "${CMAKE_SOURCE_DIR}/fatfs_image")
set(OPEN_DESKOS_FATFS_SOURCE_ROOT "${OPEN_DESKOS_FATFS_IMAGE_ROOT}/storage")
set(OPEN_DESKOS_FATFS_BUILD_ROOT "${CMAKE_BINARY_DIR}/fatfs_image")
set(OPEN_DESKOS_FATFS_SYSTEM_SOURCE_ROOT "${OPEN_DESKOS_FATFS_IMAGE_ROOT}/system")
set(OPEN_DESKOS_FATFS_SYSTEM_BUILD_ROOT "${CMAKE_BINARY_DIR}/system_fs_image")
set(OPEN_DESKOS_FATFS_PREPARE_STAMP "${CMAKE_BINARY_DIR}/open_deskos_prepare_fatfs_image.stamp")
set(OPEN_DESKOS_FATFS_SYSTEM_PREPARE_STAMP "${CMAKE_BINARY_DIR}/open_deskos_prepare_system_fs_image.stamp")
set(OPEN_DESKOS_BOARD_GENERATED_CMAKELISTS "${CMAKE_SOURCE_DIR}/components/gen_bmgr_codes/CMakeLists.txt")

file(GLOB_RECURSE OPEN_DESKOS_FATFS_SOURCE_FILES CONFIGURE_DEPENDS
    "${OPEN_DESKOS_FATFS_SOURCE_ROOT}/*"
)

file(GLOB_RECURSE OPEN_DESKOS_FATFS_SYSTEM_SOURCE_FILES CONFIGURE_DEPENDS
    "${OPEN_DESKOS_FATFS_SYSTEM_SOURCE_ROOT}/*"
)
# CMake's GLOB skips dot-prefixed entries by default. Explicitly pull in
# /system/.recovery/** so edits to recovery seed files still trigger a rebuild.
file(GLOB_RECURSE OPEN_DESKOS_FATFS_SYSTEM_HIDDEN_SOURCE_FILES CONFIGURE_DEPENDS
    "${OPEN_DESKOS_FATFS_SYSTEM_SOURCE_ROOT}/.recovery/*"
)
list(APPEND OPEN_DESKOS_FATFS_SYSTEM_SOURCE_FILES
    ${OPEN_DESKOS_FATFS_SYSTEM_HIDDEN_SOURCE_FILES})

set(OPEN_DESKOS_BOARD_FATFS_SYSTEM_COPY_COMMANDS "")
set(OPEN_DESKOS_BOARD_FATFS_SOURCE_FILES "")

if(EXISTS "${OPEN_DESKOS_BOARD_GENERATED_CMAKELISTS}")
    file(STRINGS "${OPEN_DESKOS_BOARD_GENERATED_CMAKELISTS}" OPEN_DESKOS_BOARD_PATH_LINE
        REGEX "^message\\(STATUS \"Board Path: .+\"\\)$"
    )

    if(OPEN_DESKOS_BOARD_PATH_LINE)
        list(GET OPEN_DESKOS_BOARD_PATH_LINE 0 OPEN_DESKOS_BOARD_PATH_LINE)
        string(REGEX REPLACE
            "^message\\(STATUS \"Board Path: (.*)\"\\)$"
            "\\1"
            OPEN_DESKOS_BOARD_PATH
            "${OPEN_DESKOS_BOARD_PATH_LINE}"
        )

        set(OPEN_DESKOS_BOARD_FATFS_SOURCE_ROOT "${OPEN_DESKOS_BOARD_PATH}/fatfs_image")

        if(EXISTS "${OPEN_DESKOS_BOARD_FATFS_SOURCE_ROOT}")
            file(GLOB_RECURSE OPEN_DESKOS_BOARD_FATFS_SOURCE_FILES CONFIGURE_DEPENDS
                "${OPEN_DESKOS_BOARD_FATFS_SOURCE_ROOT}/*"
            )

            list(APPEND OPEN_DESKOS_BOARD_FATFS_SYSTEM_COPY_COMMANDS
                COMMAND ${CMAKE_COMMAND} -E copy_directory
                        "${OPEN_DESKOS_BOARD_FATFS_SOURCE_ROOT}"
                        "${OPEN_DESKOS_FATFS_SYSTEM_BUILD_ROOT}"
            )
        endif()
    endif()
endif()

add_custom_command(
    OUTPUT "${OPEN_DESKOS_FATFS_PREPARE_STAMP}"
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${OPEN_DESKOS_FATFS_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E make_directory "${OPEN_DESKOS_FATFS_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${OPEN_DESKOS_FATFS_SOURCE_ROOT}"
            "${OPEN_DESKOS_FATFS_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E touch "${OPEN_DESKOS_FATFS_PREPARE_STAMP}"
    DEPENDS ${OPEN_DESKOS_FATFS_SOURCE_FILES}
    VERBATIM
)

add_custom_target(open_deskos_prepare_fatfs_image
    DEPENDS "${OPEN_DESKOS_FATFS_PREPARE_STAMP}"
)

# Prepare the read-only system partition build tree: mirror the source
# system_fs_image/ into a build-side staging dir that skill/lua syncs
# can also write into before fatfsgen packs it.
add_custom_command(
    OUTPUT "${OPEN_DESKOS_FATFS_SYSTEM_PREPARE_STAMP}"
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${OPEN_DESKOS_FATFS_SYSTEM_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E make_directory "${OPEN_DESKOS_FATFS_SYSTEM_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${OPEN_DESKOS_FATFS_SYSTEM_SOURCE_ROOT}"
            "${OPEN_DESKOS_FATFS_SYSTEM_BUILD_ROOT}"
    ${OPEN_DESKOS_BOARD_FATFS_SYSTEM_COPY_COMMANDS}
    COMMAND ${CMAKE_COMMAND} -E touch "${OPEN_DESKOS_FATFS_SYSTEM_PREPARE_STAMP}"
    DEPENDS ${OPEN_DESKOS_FATFS_SYSTEM_SOURCE_FILES} ${OPEN_DESKOS_BOARD_FATFS_SOURCE_FILES}
    VERBATIM
)

add_custom_target(open_deskos_prepare_system_fs_image
    DEPENDS "${OPEN_DESKOS_FATFS_SYSTEM_PREPARE_STAMP}"
)

fatfs_create_rawflash_image(system "${OPEN_DESKOS_FATFS_SYSTEM_BUILD_ROOT}" FLASH_IN_PROJECT)
fatfs_create_spiflash_image(storage "${OPEN_DESKOS_FATFS_BUILD_ROOT}" FLASH_IN_PROJECT)

# Skill / Lua resources are now baked into the read-only system partition
# so storage can be reformatted at runtime without losing them.
skill_builder_configure_skill_sync(
    TARGET fatfs_system_bin
    SKILL_OUTPUT_DIR "${OPEN_DESKOS_FATFS_SYSTEM_BUILD_ROOT}/skills"
)

lua_module_builder_configure_builtin_lua_sync(
    TARGET fatfs_system_bin
    BUILTIN_OUTPUT_DIR "${OPEN_DESKOS_FATFS_SYSTEM_BUILD_ROOT}/scripts/builtin"
    DOCS_OUTPUT_DIR "${OPEN_DESKOS_FATFS_SYSTEM_BUILD_ROOT}/scripts/docs"
)

add_dependencies(skill_builder_sync_skills open_deskos_prepare_system_fs_image)
add_dependencies(lua_module_builder_sync_builtin_scripts open_deskos_prepare_system_fs_image)
add_dependencies(lua_module_builder_sync_docs open_deskos_prepare_system_fs_image)
add_dependencies(fatfs_system_bin open_deskos_prepare_system_fs_image)
add_dependencies(fatfs_storage_bin open_deskos_prepare_fatfs_image)

add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/skill_builder_sync.stamp"
    APPEND
    DEPENDS "${OPEN_DESKOS_FATFS_SYSTEM_PREPARE_STAMP}"
)

add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/lua_module_builder_builtin_scripts_sync.stamp"
    APPEND
    DEPENDS "${OPEN_DESKOS_FATFS_SYSTEM_PREPARE_STAMP}"
)

add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/lua_module_builder_docs_sync.stamp"
    APPEND
    DEPENDS "${OPEN_DESKOS_FATFS_SYSTEM_PREPARE_STAMP}"
)
