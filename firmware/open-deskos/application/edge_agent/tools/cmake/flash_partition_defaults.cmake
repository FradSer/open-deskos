set(EDGE_AGENT_PROJECT_LOG_PREFIX "[edge_agent]")
set(EDGE_AGENT_FLASH_SIZE "")
set(EDGE_AGENT_BOARD_MANAGER_DEFAULTS "${CMAKE_SOURCE_DIR}/components/gen_bmgr_codes/board_manager.defaults")
if(EXISTS "${EDGE_AGENT_BOARD_MANAGER_DEFAULTS}")
    file(STRINGS "${EDGE_AGENT_BOARD_MANAGER_DEFAULTS}" _flash_line REGEX "^CONFIG_ESPTOOLPY_FLASHSIZE_(4|8|16|32)MB=y$")
    if(_flash_line)
        list(GET _flash_line 0 _flash_line)
        string(REGEX REPLACE "^CONFIG_ESPTOOLPY_FLASHSIZE_((4|8|16|32)MB)=y$" "\\1" EDGE_AGENT_FLASH_SIZE "${_flash_line}")
    endif()
endif()

# A board may declare its own partition table via sdkconfig.defaults.board (it
# lands in board_manager.defaults). An explicit board table wins over the
# flash-size default, so a board can carve board-specific partitions (e.g.
# Open DeskOS's headless /packages FAT) without forcing that layout on every board
# of the same flash size.
set(EDGE_AGENT_BOARD_PARTITION_CSV "")
if(EXISTS "${EDGE_AGENT_BOARD_MANAGER_DEFAULTS}")
    file(STRINGS "${EDGE_AGENT_BOARD_MANAGER_DEFAULTS}" _part_line REGEX "^CONFIG_PARTITION_TABLE_CUSTOM_FILENAME=\"[^\"]+\"$")
    if(_part_line)
        list(GET _part_line 0 _part_line)
        string(REGEX REPLACE "^CONFIG_PARTITION_TABLE_CUSTOM_FILENAME=\"([^\"]+)\"$" "\\1" EDGE_AGENT_BOARD_PARTITION_CSV "${_part_line}")
    endif()
endif()

if(EDGE_AGENT_FLASH_SIZE)
    if(EXISTS "${CMAKE_SOURCE_DIR}/sdkconfig")
        file(READ "${CMAKE_SOURCE_DIR}/sdkconfig" EDGE_AGENT_SDKCONFIG_CONTENT)
        string(REGEX REPLACE "(^|\\n)CONFIG_PARTITION_TABLE_CUSTOM_FILENAME=\"[^\\n]*\"\\n" "\\1" EDGE_AGENT_SDKCONFIG_CONTENT "${EDGE_AGENT_SDKCONFIG_CONTENT}")
        string(REGEX REPLACE "(^|\\n)CONFIG_PARTITION_TABLE_FILENAME=\"[^\\n]*\"\\n" "\\1" EDGE_AGENT_SDKCONFIG_CONTENT "${EDGE_AGENT_SDKCONFIG_CONTENT}")
        file(WRITE "${CMAKE_SOURCE_DIR}/sdkconfig" "${EDGE_AGENT_SDKCONFIG_CONTENT}")
    endif()

    if(EDGE_AGENT_BOARD_PARTITION_CSV)
        set(EDGE_AGENT_PARTITION_CSV "${EDGE_AGENT_BOARD_PARTITION_CSV}")
    else()
        set(EDGE_AGENT_PARTITION_CSV "partitions_${EDGE_AGENT_FLASH_SIZE}.csv")
    endif()

    set(EDGE_AGENT_PARTITION_DEFAULTS "${CMAKE_BINARY_DIR}/edge_agent_partition_auto.defaults")
    file(WRITE "${EDGE_AGENT_PARTITION_DEFAULTS}"
        "# Auto-generated from flash size / board selection. Do not edit.\n"
        "CONFIG_PARTITION_TABLE_CUSTOM=y\n"
        "CONFIG_PARTITION_TABLE_CUSTOM_FILENAME=\"${EDGE_AGENT_PARTITION_CSV}\"\n")

    if(SDKCONFIG_DEFAULTS)
        set(SDKCONFIG_DEFAULTS "${SDKCONFIG_DEFAULTS};${EDGE_AGENT_PARTITION_DEFAULTS}")
    elseif(NOT "$ENV{SDKCONFIG_DEFAULTS}" STREQUAL "")
        set(SDKCONFIG_DEFAULTS "$ENV{SDKCONFIG_DEFAULTS};${EDGE_AGENT_PARTITION_DEFAULTS}")
    else()
        set(SDKCONFIG_DEFAULTS "${CMAKE_SOURCE_DIR}/sdkconfig.defaults;${EDGE_AGENT_PARTITION_DEFAULTS}")
    endif()

    message(STATUS "${EDGE_AGENT_PROJECT_LOG_PREFIX} Partition table selected: ${EDGE_AGENT_PARTITION_CSV}")
endif()
