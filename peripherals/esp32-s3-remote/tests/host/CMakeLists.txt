cmake_minimum_required(VERSION 3.16)
project(touchpad_gesture_test C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

add_executable(touchpad_gesture_test
  touchpad_gesture_test.c
  ../../main/touchpad_gesture.c
  ../../main/cst328_frame.c
)

target_include_directories(touchpad_gesture_test PRIVATE
  ../../main
)

target_compile_definitions(touchpad_gesture_test PRIVATE
  REMOTE_SOURCE="${CMAKE_CURRENT_SOURCE_DIR}/../../main/remote_control.c"
)

enable_testing()
add_test(NAME touchpad_gesture_test COMMAND touchpad_gesture_test)

# Share the existing host fixture instead of vendoring a second cJSON copy.
set(CJSON_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../research/esp32-p4-c6-deskos/firmware/tests/host/vendor/cjson")
add_executable(remote_state_frame_test
  remote_state_frame_test.c
  ../../main/remote_state_frame.c
  "${CJSON_DIR}/cJSON.c"
)
target_include_directories(remote_state_frame_test PRIVATE ../../main "${CJSON_DIR}")
target_compile_options(remote_state_frame_test PRIVATE -Wall -Wextra -Werror)
add_test(NAME remote_state_frame_test COMMAND remote_state_frame_test)
