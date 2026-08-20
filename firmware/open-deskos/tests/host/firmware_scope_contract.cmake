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
if(NOT BOARD_COUNT EQUAL 1)
    message(FATAL_ERROR "expected exactly one production board, found ${BOARD_COUNT}")
endif()

list(GET BOARD_DIRS 0 ONLY_BOARD)
if(NOT ONLY_BOARD STREQUAL "${BOARDS_ROOT}/guition/jc4880p443c")
    message(FATAL_ERROR "unexpected production board: ${ONLY_BOARD}")
endif()

file(READ "${ONLY_BOARD}/board_info.yaml" BOARD_INFO)
string(FIND "${BOARD_INFO}" "board: jc4880p443c" BOARD_ID_OFFSET)
if(BOARD_ID_OFFSET EQUAL -1)
    message(FATAL_ERROR "production board ID must be jc4880p443c")
endif()

file(READ "${OPEN_DESKOS_ROOT}/CMakeLists.txt" CMAKE_SOURCE)
string(FIND "${CMAKE_SOURCE}" "project(open_deskos VERSION" PROJECT_OFFSET)
if(PROJECT_OFFSET EQUAL -1)
    message(FATAL_ERROR "ESP-IDF project identity must be open_deskos")
endif()
