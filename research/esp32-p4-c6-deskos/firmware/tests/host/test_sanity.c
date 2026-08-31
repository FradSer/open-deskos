/*
 * Host harness sanity test.
 *
 * Proves two things about a clean host build (ESP-IDF toolchain inactive):
 *   1. Unity links and runs.
 *   2. The vendored Lua VM compiles on the host and executes bytecode: it runs
 *      "return 1+1" and the result is asserted to equal 2.
 *   3. Periodic work can be coalesced without replaying stale timer callbacks.
 */
#include "unity.h"
#include "odk_tick_gate.h"
#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"

void setUp(void) {}
void tearDown(void) {}

static void test_unity_is_alive(void)
{
    TEST_ASSERT_EQUAL_INT(2, 1 + 1);
}

static void test_lua_vm_evaluates_expression(void)
{
    lua_State *L = luaL_newstate();
    TEST_ASSERT_NOT_NULL(L);
    luaL_openlibs(L);

    int status = luaL_dostring(L, "return 1+1");
    TEST_ASSERT_EQUAL_INT_MESSAGE(LUA_OK, status,
                                  "luaL_dostring must succeed for 'return 1+1'");
    TEST_ASSERT_TRUE_MESSAGE(lua_isinteger(L, -1),
                             "result of 1+1 must be an integer");
    TEST_ASSERT_EQUAL_INT(2, (int)lua_tointeger(L, -1));

    lua_close(L);
}

static void test_tick_gate_coalesces_pending_work(void)
{
    odk_tick_gate_t gate;

    odk_tick_gate_init(&gate);
    TEST_ASSERT_TRUE_MESSAGE(odk_tick_gate_mark(&gate),
                             "the first periodic tick must become pending");
    TEST_ASSERT_FALSE_MESSAGE(odk_tick_gate_mark(&gate),
                              "duplicate timer callbacks must coalesce while pending");
    TEST_ASSERT_TRUE_MESSAGE(odk_tick_gate_consume(&gate),
                             "the worker must consume the one pending tick");
    TEST_ASSERT_FALSE_MESSAGE(odk_tick_gate_consume(&gate),
                              "consuming a tick must clear the pending state");

    TEST_ASSERT_TRUE_MESSAGE(odk_tick_gate_mark(&gate),
                             "a later tick may be scheduled after consumption");
    odk_tick_gate_clear(&gate);
    TEST_ASSERT_FALSE_MESSAGE(odk_tick_gate_consume(&gate),
                              "a failed queue submission must clear pending state");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_unity_is_alive);
    RUN_TEST(test_lua_vm_evaluates_expression);
    RUN_TEST(test_tick_gate_coalesces_pending_work);
    return UNITY_END();
}
