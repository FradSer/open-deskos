cmake_minimum_required(VERSION 3.16)
project(touchpad_gesture_test C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

add_executable(touchpad_gesture_test
  touchpad_gesture_test.c
  ../../main/touchpad_gesture.c
)

target_include_directories(touchpad_gesture_test PRIVATE
  ../../main
)

enable_testing()
add_test(NAME touchpad_gesture_test COMMAND touchpad_gesture_test)
