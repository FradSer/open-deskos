Feature: Hardened Lua sandbox enforcement

  Scenario: Script calling a non-whitelisted global is contained to the call
    Given "fancy_widget_02" is installed and running
    When its Lua script calls io.open("/etc/passwd", "r")
    Then the call raises a Lua error "io is not available"
    And the content player session continues
    And the audio/HID output is not interrupted
    And no file is opened

  Scenario: Script exceeding the instruction budget is terminated for that call
    Given "fancy_widget_02" is running with LUA_MASKCOUNT set to 1000000 instructions
    When its Lua script enters an infinite loop
    Then the count hook fires and raises a Lua error within the budget
    And the FreeRTOS Task WDT does not fire first
    And the session continues

  Scenario: Script exceeding the memory budget raises a recoverable OOM
    Given "fancy_widget_02" is running with a 128KB lua_setallocf budget
    When its Lua script attempts to allocate beyond 128KB
    Then the allocator returns NULL
    And Lua raises a pcall-recoverable OOM error
    And the process does not abort()

  Scenario: Precompiled bytecode is rejected
    Given "evil_app_01" ships an "app/main.luac" containing binary bytecode
    When the sandbox loads it
    Then load is called with mode="t"
    And the binary chunk is rejected
    And no bytecode executes

  Scenario: string.dump is not available
    Given "fancy_widget_02" is running
    When its Lua script calls string.dump
    Then the call raises "string.dump is not available"

  Scenario: Standard library writes stay inside one App sandbox
    Given "fancy_widget_02" is running
    When its Lua script replaces string.format and math.max
    Then the replacements affect only that App sandbox
    And the Shell dashboard and quota widgets retain their standard-library functions

  Scenario: 脚本环境只见白名单(_ENV preload-env 隔离)
    Given 沙盒以 2 个白名单 C 绑定("ping"、"log")创建
    When 脚本枚举其 _ENV 的全部键
    Then 键集合恰为白名单 + 允许的标准子集(base 裁剪版/string 去 dump/math/table)
    And os、io、package、debug、require、coroutine 均不可达
