set(OPEN_DESKOS_ROOT "${ODK_ROOT}/application/open_deskos")
set(BOARDS_ROOT "${OPEN_DESKOS_ROOT}/boards")

if(NOT IS_DIRECTORY "${OPEN_DESKOS_ROOT}")
    message(FATAL_ERROR "Open DeskOS application directory is missing")
endif()

if(IS_DIRECTORY "${ODK_ROOT}/application/edge_agent")
    message(FATAL_ERROR "legacy edge_agent application directory must be absent")
endif()

if(IS_DIRECTORY "${ODK_ROOT}/application/mcp_server_point")
    message(FATAL_ERROR "upstream sample application must be absent")
endif()

file(GLOB BOARD_DIRS LIST_DIRECTORIES true "${BOARDS_ROOT}/*/*")
list(LENGTH BOARD_DIRS BOARD_COUNT)
if(NOT BOARD_COUNT EQUAL 3)
    message(FATAL_ERROR "expected exactly three production boards, found ${BOARD_COUNT}")
endif()

foreach(required_board IN ITEMS
        "${BOARDS_ROOT}/guition/jc4880p443c"
        "${BOARDS_ROOT}/waveshare/esp32_s3_touch_lcd_2_8"
        "${BOARDS_ROOT}/m5stack/m5papercolor")
    list(FIND BOARD_DIRS "${required_board}" BOARD_INDEX)
    if(BOARD_INDEX EQUAL -1)
        message(FATAL_ERROR "required production board is missing: ${required_board}")
    endif()
endforeach()

file(READ "${BOARDS_ROOT}/guition/jc4880p443c/board_info.yaml" P4_INFO)
string(FIND "${P4_INFO}" "board: jc4880p443c" P4_ID_OFFSET)
if(P4_ID_OFFSET EQUAL -1)
    message(FATAL_ERROR "production P4 board ID must be jc4880p443c")
endif()

file(READ "${BOARDS_ROOT}/waveshare/esp32_s3_touch_lcd_2_8/board_info.yaml" S3_INFO)
string(FIND "${S3_INFO}" "board: esp32_s3_touch_lcd_2_8" S3_ID_OFFSET)
if(S3_ID_OFFSET EQUAL -1)
    message(FATAL_ERROR "production S3 board ID is missing")
endif()

file(READ "${BOARDS_ROOT}/m5stack/m5papercolor/board_info.yaml" M5_INFO)
string(FIND "${M5_INFO}" "board: m5papercolor" M5_ID_OFFSET)
if(M5_ID_OFFSET EQUAL -1)
    message(FATAL_ERROR "production M5PaperColor board ID is missing")
endif()

file(READ "${OPEN_DESKOS_ROOT}/CMakeLists.txt" CMAKE_SOURCE)
string(FIND "${CMAKE_SOURCE}" "project(open_deskos VERSION" PROJECT_OFFSET)
if(PROJECT_OFFSET EQUAL -1)
    message(FATAL_ERROR "ESP-IDF project identity must be open_deskos")
endif()
