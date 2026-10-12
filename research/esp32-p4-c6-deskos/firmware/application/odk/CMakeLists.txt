cmake_minimum_required(VERSION 3.16)

include("${CMAKE_SOURCE_DIR}/tools/cmake/esp_idf_patch.cmake")
include("${CMAKE_SOURCE_DIR}/tools/cmake/flash_partition_defaults.cmake")

# managed_components/ is gitignored — re-apply strncpy→snprintf fixes needed
# for CONFIG_COMPILER_OPTIMIZATION_PERF (-Werror=stringop-truncation).
find_program(ODK_PYTHON NAMES python3 python REQUIRED)
execute_process(
    COMMAND "${ODK_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_mcp_c_sdk_perf.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE ODK_MCP_PATCH_RC
)
if(NOT ODK_MCP_PATCH_RC EQUAL 0)
    message(WARNING "[odk] mcp-c-sdk PERF patch script failed (rc=${ODK_MCP_PATCH_RC})")
endif()

# DPI ISR requires adapter bridge user_ctx in internal RAM (PSRAM calloc breaks the MIPI triple-buffer route).
execute_process(
    COMMAND "${ODK_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_esp_lvgl_adapter_internal_ctx.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE ODK_ADAPTER_PATCH_RC
)
if(NOT ODK_ADAPTER_PATCH_RC EQUAL 0)
    message(WARNING "[odk] esp_lvgl_adapter internal-ctx patch failed (rc=${ODK_ADAPTER_PATCH_RC})")
endif()

# The production board catalog includes the P4 and compact S3 targets. The S3
# uses the SPI path and must not run P4-only adapter patching assumptions.

# P4's PPA validates output buffers against the external-DMA cache alignment.
if(NOT IDF_TARGET STREQUAL "esp32s3")
# Snapshot layers can legitimately use a different backing alignment, so make
# the adapter fall back to LVGL's software blender instead of aborting the UI.
execute_process(
    COMMAND "${ODK_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_esp_lvgl_adapter_ppa_alignment.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE ODK_ADAPTER_PPA_ALIGNMENT_PATCH_RC
)
if(NOT ODK_ADAPTER_PPA_ALIGNMENT_PATCH_RC EQUAL 0)
    message(WARNING "[odk] esp_lvgl_adapter PPA alignment patch failed (rc=${ODK_ADAPTER_PPA_ALIGNMENT_PATCH_RC})")
endif()

# LVGL 9.5 built-in ESP-PPA invalidate_cache msyncs the PSRAM draw buffer
# without ESP_CACHE_MSYNC_FLAG_UNALIGNED, so every PPA op with a non-64B-aligned
# data_size fails to flush CPU writes -> stale-cache reads -> garbled frames
# during big redraws (launcher hero animation "jumping" to its end state).
execute_process(
    COMMAND "${ODK_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_lvgl_ppa_cache_unaligned.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE ODK_LVGL_PPA_PATCH_RC
)
if(NOT ODK_LVGL_PPA_PATCH_RC EQUAL 0)
    message(WARNING "[odk] lvgl PPA cache-unaligned patch failed (rc=${ODK_LVGL_PPA_PATCH_RC})")
endif()

# ESP32-P4 PPA SRM has a hardware hang bug (DIG-734): a non-trivial DMA2D
# output block can stall the transaction forever. Espressif's temporary fix
# (managed_components/espressif__esp_lvgl_adapter/0001-bugfix-ppa-*.patch)
# always bypasses SRM's macroblock-order path. With LV_USE_PPA on, the first
# SRM op on a hanging geometry blocks the render task (task alive, no Guru) —
# the launcher stalls before "voice UI running". The patch file is never
# applied by anything; this scripts it against the IDF component itself.
execute_process(
    COMMAND "${ODK_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_esp_driver_ppa_dig734.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE ODK_DIG734_PATCH_RC
)
if(NOT ODK_DIG734_PATCH_RC EQUAL 0)
    message(WARNING "[odk] esp_driver_ppa DIG-734 patch failed (rc=${ODK_DIG734_PATCH_RC})")
endif()

# bmgr regenerates gen_bmgr_codes/CMakeLists.txt each pass with only
# REQUIRES esp_board_manager; this board's setup_device.c needs the local
# display/touch components too, so patch the generated REQUIRES line.
execute_process(
    COMMAND "${ODK_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_gen_bmgr_requires.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE ODK_BMGR_REQ_PATCH_RC
)
if(NOT ODK_BMGR_REQ_PATCH_RC EQUAL 0)
    message(WARNING "[odk] gen_bmgr REQUIRES patch failed (rc=${ODK_BMGR_REQ_PATCH_RC})")
endif()

endif()

# ThorVG (LVGL's SW vector backend for aiodi.svg_icon) compares a plain char
# to < 0, which -Werror=type-limits rejects on riscv32 where char is unsigned.
execute_process(
    COMMAND "${ODK_PYTHON}" "${CMAKE_SOURCE_DIR}/tools/patch_lvgl_thorvg_werror.py"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE ODK_LVGL_THORVG_PATCH_RC
)
if(NOT ODK_LVGL_THORVG_PATCH_RC EQUAL 0)
    message(WARNING "[odk] lvgl ThorVG Werror patch failed (rc=${ODK_LVGL_THORVG_PATCH_RC})")
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
project(odk VERSION 0.1.0)

set(ODK_FATFS_IMAGE_ROOT "${CMAKE_SOURCE_DIR}/fatfs_image")
set(ODK_FATFS_SOURCE_ROOT "${ODK_FATFS_IMAGE_ROOT}/storage")
set(ODK_FATFS_BUILD_ROOT "${CMAKE_BINARY_DIR}/fatfs_image")
set(ODK_FATFS_SYSTEM_SOURCE_ROOT "${ODK_FATFS_IMAGE_ROOT}/system")
set(ODK_FATFS_SYSTEM_BUILD_ROOT "${CMAKE_BINARY_DIR}/system_fs_image")
set(ODK_FATFS_PREPARE_STAMP "${CMAKE_BINARY_DIR}/odk_prepare_fatfs_image.stamp")
set(ODK_FATFS_SYSTEM_PREPARE_STAMP "${CMAKE_BINARY_DIR}/odk_prepare_system_fs_image.stamp")
set(ODK_BOARD_GENERATED_CMAKELISTS "${CMAKE_SOURCE_DIR}/components/gen_bmgr_codes/CMakeLists.txt")

file(GLOB_RECURSE ODK_FATFS_SOURCE_FILES CONFIGURE_DEPENDS
    "${ODK_FATFS_SOURCE_ROOT}/*"
)

file(GLOB_RECURSE ODK_FATFS_SYSTEM_SOURCE_FILES CONFIGURE_DEPENDS
    "${ODK_FATFS_SYSTEM_SOURCE_ROOT}/*"
)
# CMake's GLOB skips dot-prefixed entries by default. Explicitly pull in
# /system/.recovery/** so edits to recovery seed files still trigger a rebuild.
file(GLOB_RECURSE ODK_FATFS_SYSTEM_HIDDEN_SOURCE_FILES CONFIGURE_DEPENDS
    "${ODK_FATFS_SYSTEM_SOURCE_ROOT}/.recovery/*"
)
list(APPEND ODK_FATFS_SYSTEM_SOURCE_FILES
    ${ODK_FATFS_SYSTEM_HIDDEN_SOURCE_FILES})

set(ODK_BOARD_FATFS_SYSTEM_COPY_COMMANDS "")
set(ODK_BOARD_FATFS_SOURCE_FILES "")

if(EXISTS "${ODK_BOARD_GENERATED_CMAKELISTS}")
    file(STRINGS "${ODK_BOARD_GENERATED_CMAKELISTS}" ODK_BOARD_PATH_LINE
        REGEX "^message\\(STATUS \"Board Path: .+\"\\)$"
    )

    if(ODK_BOARD_PATH_LINE)
        list(GET ODK_BOARD_PATH_LINE 0 ODK_BOARD_PATH_LINE)
        string(REGEX REPLACE
            "^message\\(STATUS \"Board Path: (.*)\"\\)$"
            "\\1"
            ODK_BOARD_PATH
            "${ODK_BOARD_PATH_LINE}"
        )

        set(ODK_BOARD_FATFS_SOURCE_ROOT "${ODK_BOARD_PATH}/fatfs_image")

        if(EXISTS "${ODK_BOARD_FATFS_SOURCE_ROOT}")
            file(GLOB_RECURSE ODK_BOARD_FATFS_SOURCE_FILES CONFIGURE_DEPENDS
                "${ODK_BOARD_FATFS_SOURCE_ROOT}/*"
            )

            list(APPEND ODK_BOARD_FATFS_SYSTEM_COPY_COMMANDS
                COMMAND ${CMAKE_COMMAND} -E copy_directory
                        "${ODK_BOARD_FATFS_SOURCE_ROOT}"
                        "${ODK_FATFS_SYSTEM_BUILD_ROOT}"
            )
        endif()
    endif()
endif()

add_custom_command(
    OUTPUT "${ODK_FATFS_PREPARE_STAMP}"
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${ODK_FATFS_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E make_directory "${ODK_FATFS_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${ODK_FATFS_SOURCE_ROOT}"
            "${ODK_FATFS_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E touch "${ODK_FATFS_PREPARE_STAMP}"
    DEPENDS ${ODK_FATFS_SOURCE_FILES}
    VERBATIM
)

add_custom_target(odk_prepare_fatfs_image
    DEPENDS "${ODK_FATFS_PREPARE_STAMP}"
)

# Prepare the read-only system partition build tree: mirror the source
# system_fs_image/ into a build-side staging dir that skill/lua syncs
# can also write into before fatfsgen packs it.
add_custom_command(
    OUTPUT "${ODK_FATFS_SYSTEM_PREPARE_STAMP}"
    COMMAND ${CMAKE_COMMAND} -E rm -rf "${ODK_FATFS_SYSTEM_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E make_directory "${ODK_FATFS_SYSTEM_BUILD_ROOT}"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${ODK_FATFS_SYSTEM_SOURCE_ROOT}"
            "${ODK_FATFS_SYSTEM_BUILD_ROOT}"
    ${ODK_BOARD_FATFS_SYSTEM_COPY_COMMANDS}
    COMMAND ${CMAKE_COMMAND} -E touch "${ODK_FATFS_SYSTEM_PREPARE_STAMP}"
    DEPENDS ${ODK_FATFS_SYSTEM_SOURCE_FILES} ${ODK_BOARD_FATFS_SOURCE_FILES}
    VERBATIM
)

add_custom_target(odk_prepare_system_fs_image
    DEPENDS "${ODK_FATFS_SYSTEM_PREPARE_STAMP}"
)

fatfs_create_rawflash_image(system "${ODK_FATFS_SYSTEM_BUILD_ROOT}" FLASH_IN_PROJECT)
fatfs_create_spiflash_image(storage "${ODK_FATFS_BUILD_ROOT}" FLASH_IN_PROJECT)

# Skill / Lua resources are now baked into the read-only system partition
# so storage can be reformatted at runtime without losing them.
skill_builder_configure_skill_sync(
    TARGET fatfs_system_bin
    SKILL_OUTPUT_DIR "${ODK_FATFS_SYSTEM_BUILD_ROOT}/skills"
)

lua_module_builder_configure_builtin_lua_sync(
    TARGET fatfs_system_bin
    BUILTIN_OUTPUT_DIR "${ODK_FATFS_SYSTEM_BUILD_ROOT}/scripts/builtin"
    DOCS_OUTPUT_DIR "${ODK_FATFS_SYSTEM_BUILD_ROOT}/scripts/docs"
)

add_dependencies(skill_builder_sync_skills odk_prepare_system_fs_image)
add_dependencies(lua_module_builder_sync_builtin_scripts odk_prepare_system_fs_image)
add_dependencies(lua_module_builder_sync_docs odk_prepare_system_fs_image)
add_dependencies(fatfs_system_bin odk_prepare_system_fs_image)
add_dependencies(fatfs_storage_bin odk_prepare_fatfs_image)

add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/skill_builder_sync.stamp"
    APPEND
    DEPENDS "${ODK_FATFS_SYSTEM_PREPARE_STAMP}"
)

add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/lua_module_builder_builtin_scripts_sync.stamp"
    APPEND
    DEPENDS "${ODK_FATFS_SYSTEM_PREPARE_STAMP}"
)

add_custom_command(
    OUTPUT "${CMAKE_BINARY_DIR}/lua_module_builder_docs_sync.stamp"
    APPEND
    DEPENDS "${ODK_FATFS_SYSTEM_PREPARE_STAMP}"
)
