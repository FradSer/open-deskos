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

add_executable(remote_radio_frame_test remote_radio_frame_test.c ../../main/remote_radio_frame.c)
target_include_directories(remote_radio_frame_test PRIVATE ../../main)
target_compile_options(remote_radio_frame_test PRIVATE -Wall -Wextra -Werror)
add_test(NAME remote_radio_frame_test COMMAND remote_radio_frame_test)

# Keep SDK stand-ins local to this host target and its build directory.
set(RADIO_SDK_FIXTURE_DIR "${CMAKE_CURRENT_BINARY_DIR}/radio-sdk-fixture")
file(MAKE_DIRECTORY "${RADIO_SDK_FIXTURE_DIR}/freertos")
foreach(header IN ITEMS
  esp_err.h freertos/FreeRTOS.h freertos/queue.h
  esp_event.h esp_netif.h esp_now.h esp_random.h esp_timer.h esp_wifi.h
  nvs.h nvs_flash.h
)
  file(WRITE "${RADIO_SDK_FIXTURE_DIR}/${header}"
    "#include \"remote_radio_sdk_fixture.h\"\n")
endforeach()
add_executable(remote_radio_lifecycle_test
  remote_radio_lifecycle_test.c
  ../../main/remote_radio.c
  ../../main/remote_radio_frame.c
  ../../main/remote_state_frame.c
  "${CJSON_DIR}/cJSON.c"
)
target_include_directories(remote_radio_lifecycle_test PRIVATE
  "${RADIO_SDK_FIXTURE_DIR}" "${CMAKE_CURRENT_SOURCE_DIR}"
  ../../main "${CJSON_DIR}"
)
target_compile_options(remote_radio_lifecycle_test PRIVATE -Wall -Wextra -Werror)
add_test(NAME remote_radio_lifecycle_test COMMAND remote_radio_lifecycle_test)
