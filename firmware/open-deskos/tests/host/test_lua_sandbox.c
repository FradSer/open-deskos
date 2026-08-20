/*
 * L4 adversarial tests for the hardened Lua sandbox (odk_sandbox). Real
 * malicious/edge-case Lua source runs against the vendored Lua 5.5 VM
 * exclusively through the odk_sandbox_* contract — no test reaches into
 * Lua internals to fake a result. The suite performs zero I/O and zero
 * network access; the memory pool for every sandbox is a static host buffer.
 *
 * Each TEST_CASE below corresponds to one scenario in
 * tests/features/lua-sandbox.feature (scenario title quoted in the comment
 * above each test). This is the RED half of a Red-Green pair: sandbox.c
 * under test is a placeholder body that unconditionally reports
 * ODK_ERR_NOT_IMPLEMENTED and never touches the Lua VM, so every assertion
 * below is expected to fail until task-004-impl lands the five hardening
 * measures from architecture §4.2.
 */
#include <stdbool.h>
#include <string.h>
#include <time.h>

#include "unity.h"

#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"

#include "odk_err.h"
#include "odk_sandbox.h"

#define SANDBOX_POOL_SIZE_DEFAULT (64 * 1024)
#define SANDBOX_POOL_SIZE_OOM_BUDGET (128 * 1024)
#define LOG_CAPTURE_MAX_ENTRIES 96
#define LOG_CAPTURE_ENTRY_LEN 48

/* ---- fake whitelist C bindings, closing over file-scope capture state ----
 *
 * odk_api_reg_t.fn is a plain lua_CFunction with no extra argument slot for
 * api_ctx, so these test doubles capture into module-static storage instead
 * of relying on any particular internal wiring of api_ctx (that wiring is a
 * 004-impl implementation detail this test must not presuppose).
 */

static struct {
    char entries[LOG_CAPTURE_MAX_ENTRIES][LOG_CAPTURE_ENTRY_LEN];
    size_t count;
} g_log_capture;

static void log_capture_reset(void)
{
    g_log_capture.count = 0;
}

static bool log_capture_contains(const char *needle)
{
    for (size_t i = 0; i < g_log_capture.count; i++) {
        if (strcmp(g_log_capture.entries[i], needle) == 0) {
            return true;
        }
    }
    return false;
}

/* "ping": the simplest possible whitelisted binding, present so a script
 * always has at least one trivially callable C function. */
static int test_api_ping(lua_State *L)
{
    lua_pushboolean(L, 1);
    return 1;
}

/* "log": records its single string argument, used by scripts under test to
 * report what they observed inside their own sandboxed _ENV. */
static int test_api_log(lua_State *L)
{
    const char *msg = luaL_checklstring(L, 1, NULL);
    if (g_log_capture.count < LOG_CAPTURE_MAX_ENTRIES) {
        strncpy(g_log_capture.entries[g_log_capture.count], msg, LOG_CAPTURE_ENTRY_LEN - 1);
        g_log_capture.entries[g_log_capture.count][LOG_CAPTURE_ENTRY_LEN - 1] = '\0';
        g_log_capture.count++;
    }
    return 0;
}

static const odk_api_reg_t k_whitelist_api[] = {
    { "ping", test_api_ping },
    { "log", test_api_log },
};
#define WHITELIST_API_COUNT (sizeof(k_whitelist_api) / sizeof(k_whitelist_api[0]))

void setUp(void)
{
    log_capture_reset();
}

void tearDown(void) {}

/* Scenario: Script calling a non-whitelisted global is contained to the call */
static void test_script_calling_a_non_whitelisted_global_is_contained_to_the_call(void)
{
    static char pool[SANDBOX_POOL_SIZE_DEFAULT];
    odk_sandbox_limits_t limits = {
        .pool = pool,
        .pool_size = sizeof(pool),
        .instr_budget = 1000000,
    };

    odk_sandbox_t *sb = odk_sandbox_create(&limits, k_whitelist_api, WHITELIST_API_COUNT, NULL);
    TEST_ASSERT_NOT_NULL_MESSAGE(sb, "sandbox creation with valid limits must succeed");

    const char *src =
        "function main()\n"
        "  local f = io.open('/etc/passwd', 'r')\n"
        "  return f\n"
        "end\n"
        "function healthcheck()\n"
        "  return true\n"
        "end\n";
    odk_err_t load_err = odk_sandbox_load_source(sb, src, strlen(src), "fancy_widget_02/main.lua");
    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_OK, load_err,
                                  "a text-only chunk with no bytecode must load cleanly");

    char errbuf[128] = { 0 };
    odk_err_t call_err = odk_sandbox_call(sb, "main", errbuf, sizeof(errbuf));
    TEST_ASSERT_NOT_EQUAL_INT_MESSAGE((int)ODK_OK, (int)call_err,
                                      "indexing the unregistered global 'io' must raise, not silently "
                                      "return nil");
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(errbuf, "io is not available"),
                                 "the raised error must name the unavailable global, per the BDD "
                                 "Then-clause");

    /* the content player session continues: the same lua_State completes a
     * legitimate call after the contained violation, so audio/HID output
     * driven by the same task loop is never interrupted. Because the error
     * is raised before io.open ever runs, no file is opened either. */
    char errbuf2[128] = { 0 };
    odk_err_t healthcheck_err = odk_sandbox_call(sb, "healthcheck", errbuf2, sizeof(errbuf2));
    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_OK, healthcheck_err,
                                  "the sandboxed lua_State must survive a contained violation and "
                                  "accept a further call");

    odk_sandbox_destroy(sb);
}

/* Scenario: Script exceeding the instruction budget is terminated for that call */
static void test_script_exceeding_the_instruction_budget_is_terminated_for_that_call(void)
{
    static char pool[SANDBOX_POOL_SIZE_DEFAULT];
    odk_sandbox_limits_t limits = {
        .pool = pool,
        .pool_size = sizeof(pool),
        .instr_budget = 1000000,
    };

    odk_sandbox_t *sb = odk_sandbox_create(&limits, k_whitelist_api, WHITELIST_API_COUNT, NULL);
    TEST_ASSERT_NOT_NULL_MESSAGE(sb, "sandbox creation with valid limits must succeed");

    const char *src =
        "function main()\n"
        "  local i = 0\n"
        "  while true do\n"
        "    i = i + 1\n"
        "  end\n"
        "end\n"
        "function healthcheck()\n"
        "  return true\n"
        "end\n";
    odk_err_t load_err = odk_sandbox_load_source(sb, src, strlen(src), "fancy_widget_02/main.lua");
    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_OK, load_err, "an infinite-loop text chunk must still load");

    char errbuf[128] = { 0 };
    clock_t started = clock();
    odk_err_t call_err = odk_sandbox_call(sb, "main", errbuf, sizeof(errbuf));
    double elapsed_seconds = (double)(clock() - started) / CLOCKS_PER_SEC;

    /* Host-side stand-in for "the FreeRTOS Task WDT does not fire first":
     * the call must return in well under a watchdog-scale timeout, proving
     * the count hook - not a hang - ended the loop. */
    TEST_ASSERT_LESS_THAN_size_t_MESSAGE(5, (size_t)elapsed_seconds,
                                         "the LUA_MASKCOUNT hook must terminate the call within a few "
                                         "seconds of wall-clock time, well before any watchdog would fire");
    TEST_ASSERT_EQUAL_INT_MESSAGE((int)ODK_ERR_BUDGET_EXCEEDED, (int)call_err,
                                  "an infinite loop must be aborted by the instruction-count hook and "
                                  "reported as a budget-exceeded error");

    char errbuf2[128] = { 0 };
    odk_err_t healthcheck_err = odk_sandbox_call(sb, "healthcheck", errbuf2, sizeof(errbuf2));
    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_OK, healthcheck_err,
                                  "the session continues: the lua_State survives the aborted call");

    odk_sandbox_destroy(sb);
}

/* Scenario: Script exceeding the memory budget raises a recoverable OOM */
static void test_script_exceeding_the_memory_budget_raises_a_recoverable_oom(void)
{
    static char pool[SANDBOX_POOL_SIZE_OOM_BUDGET];
    odk_sandbox_limits_t limits = {
        .pool = pool,
        .pool_size = sizeof(pool),
        .instr_budget = 100000000,
    };

    odk_sandbox_t *sb = odk_sandbox_create(&limits, k_whitelist_api, WHITELIST_API_COUNT, NULL);
    TEST_ASSERT_NOT_NULL_MESSAGE(sb, "sandbox creation with a 128KB pool must succeed");

    const char *src =
        "function main()\n"
        "  local t = {}\n"
        "  for i = 1, 1000000 do\n"
        "    t[i] = string.rep('x', 1024)\n"
        "  end\n"
        "  return #t\n"
        "end\n"
        "function healthcheck()\n"
        "  return true\n"
        "end\n";
    odk_err_t load_err = odk_sandbox_load_source(sb, src, strlen(src), "fancy_widget_02/main.lua");
    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_OK, load_err, "the allocation-heavy chunk must still load as text");

    char errbuf[128] = { 0 };
    odk_err_t call_err = odk_sandbox_call(sb, "main", errbuf, sizeof(errbuf));
    TEST_ASSERT_EQUAL_INT_MESSAGE((int)ODK_ERR_OOM, (int)call_err,
                                  "allocating well past the 128KB pool budget must be reported as a "
                                  "recoverable OOM, not silently succeed");
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(errbuf, "memory"),
                                 "the pcall-recoverable LUA_ERRMEM error names memory exhaustion");

    /* the process does not abort(): reaching this line at all proves the
     * OOM unwound through a protected call instead of crashing the binary,
     * and the lua_State remains usable for a further call. */
    char errbuf2[128] = { 0 };
    odk_err_t healthcheck_err = odk_sandbox_call(sb, "healthcheck", errbuf2, sizeof(errbuf2));
    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_OK, healthcheck_err,
                                  "the lua_State must remain usable for a further call after the OOM");

    odk_sandbox_destroy(sb);
}

typedef struct {
    unsigned char data[4096];
    size_t len;
} luac_buffer_t;

static int luac_writer(lua_State *L, const void *p, size_t sz, void *ud)
{
    (void)L;
    luac_buffer_t *buf = (luac_buffer_t *)ud;
    if (buf->len + sz > sizeof(buf->data)) {
        return 1;
    }
    memcpy(buf->data + buf->len, p, sz);
    buf->len += sz;
    return 0;
}

/* Stands in for "evil_pack_01"'s offline build tooling: an ordinary,
 * unsandboxed Lua state compiles a tiny chunk and dumps it to bytecode via
 * the C lua_dump() API (not the sandboxed string.dump, whose own
 * unavailability is a separate scenario below). */
static void compile_probe_source_to_luac(luac_buffer_t *out)
{
    lua_State *builder = luaL_newstate();
    TEST_ASSERT_NOT_NULL_MESSAGE(builder, "the offline bytecode-compiling fixture must construct");

    const char *probe_src =
        "executed_flag = true\n"
        "function main() end\n";
    int load_status = luaL_loadbufferx(builder, probe_src, strlen(probe_src), "probe", "t");
    TEST_ASSERT_EQUAL_INT_MESSAGE(LUA_OK, load_status, "the probe source must compile cleanly");

    out->len = 0;
    int dump_status = lua_dump(builder, luac_writer, out, 0);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, dump_status, "lua_dump must produce a binary chunk for the probe");
    TEST_ASSERT_GREATER_THAN_size_t_MESSAGE(4, out->len,
                                            "a non-trivial chunk dumps to more than 4 bytes");
    TEST_ASSERT_EQUAL_INT_MESSAGE(LUA_SIGNATURE[0], out->data[0],
                                  "the dumped buffer must start with the Lua bytecode signature byte, "
                                  "confirming it is genuinely binary, not text");

    lua_close(builder);
}

/* Scenario: Precompiled bytecode is rejected */
static void test_precompiled_bytecode_is_rejected(void)
{
    luac_buffer_t luac;
    compile_probe_source_to_luac(&luac);

    static char pool[SANDBOX_POOL_SIZE_DEFAULT];
    odk_sandbox_limits_t limits = {
        .pool = pool,
        .pool_size = sizeof(pool),
        .instr_budget = 1000000,
    };
    odk_sandbox_t *sb = odk_sandbox_create(&limits, k_whitelist_api, WHITELIST_API_COUNT, NULL);
    TEST_ASSERT_NOT_NULL_MESSAGE(sb, "sandbox creation with valid limits must succeed");

    odk_err_t load_err = odk_sandbox_load_source(
        sb, (const char *)luac.data, luac.len, "evil_app/app/main.luac");
    TEST_ASSERT_EQUAL_INT_MESSAGE((int)ODK_ERR_SANDBOX_VIOLATION, (int)load_err,
                                  "loading with mode=\"t\" must reject a binary chunk outright");

    char errbuf[128] = { 0 };
    odk_err_t call_err = odk_sandbox_call(sb, "main", errbuf, sizeof(errbuf));
    TEST_ASSERT_NOT_EQUAL_INT_MESSAGE((int)ODK_OK, (int)call_err,
                                      "no bytecode executed: the rejected chunk's 'main' global was "
                                      "never defined, so calling it must fail");

    odk_sandbox_destroy(sb);
}

/* Scenario: string.dump is not available */
static void test_string_dump_is_not_available(void)
{
    static char pool[SANDBOX_POOL_SIZE_DEFAULT];
    odk_sandbox_limits_t limits = {
        .pool = pool,
        .pool_size = sizeof(pool),
        .instr_budget = 1000000,
    };
    odk_sandbox_t *sb = odk_sandbox_create(&limits, k_whitelist_api, WHITELIST_API_COUNT, NULL);
    TEST_ASSERT_NOT_NULL_MESSAGE(sb, "sandbox creation with valid limits must succeed");

    const char *src =
        "function main()\n"
        "  return string.dump(function() end)\n"
        "end\n";
    odk_err_t load_err = odk_sandbox_load_source(sb, src, strlen(src), "fancy_widget_02/main.lua");
    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_OK, load_err, "a text chunk calling string.dump must still load");

    char errbuf[128] = { 0 };
    odk_err_t call_err = odk_sandbox_call(sb, "main", errbuf, sizeof(errbuf));
    TEST_ASSERT_NOT_EQUAL_INT_MESSAGE((int)ODK_OK, (int)call_err,
                                      "string.dump must not be callable inside the sandbox");
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(errbuf, "string.dump is not available"),
                                 "the raised error must match the BDD Then-clause verbatim");

    odk_sandbox_destroy(sb);
}

/* Scenario: 脚本环境只见白名单(_ENV preload-env 隔离) */
static void test_script_env_sees_only_the_whitelist_env_preload_isolation(void)
{
    TEST_ASSERT_EQUAL_size_t_MESSAGE(2, WHITELIST_API_COUNT,
                                     "this scenario is defined against exactly 2 whitelist bindings");

    static char pool[SANDBOX_POOL_SIZE_DEFAULT];
    odk_sandbox_limits_t limits = {
        .pool = pool,
        .pool_size = sizeof(pool),
        .instr_budget = 1000000,
    };

    odk_sandbox_t *sb = odk_sandbox_create(&limits, k_whitelist_api, WHITELIST_API_COUNT, NULL);
    TEST_ASSERT_NOT_NULL_MESSAGE(sb, "sandbox creation with exactly 2 whitelisted bindings must succeed");

    const char *src =
        "function main()\n"
        "  for k in pairs(_ENV) do\n"
        "    log(tostring(k))\n"
        "  end\n"
        "  if string ~= nil then\n"
        "    log(string.dump == nil and 'string.dump=nil' or 'string.dump=present')\n"
        "  end\n"
        "end\n";
    odk_err_t load_err = odk_sandbox_load_source(sb, src, strlen(src), "probe/main.lua");
    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_OK, load_err, "the _ENV-enumerating chunk must load as text");

    char errbuf[128] = { 0 };
    odk_err_t call_err = odk_sandbox_call(sb, "main", errbuf, sizeof(errbuf));
    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_OK, call_err,
                                  "enumerating one's own _ENV with pairs() is not itself a violation");

    /* the whitelist bindings and the trimmed stdlib subset must be reachable */
    TEST_ASSERT_TRUE_MESSAGE(log_capture_contains("ping"),
                             "the whitelisted 'ping' binding must be visible in _ENV");
    TEST_ASSERT_TRUE_MESSAGE(log_capture_contains("log"),
                             "the whitelisted 'log' binding must be visible in _ENV");
    TEST_ASSERT_TRUE_MESSAGE(log_capture_contains("string"),
                             "the trimmed 'string' library must be visible in _ENV");
    TEST_ASSERT_TRUE_MESSAGE(log_capture_contains("math"),
                             "the 'math' library must be visible in _ENV");
    TEST_ASSERT_TRUE_MESSAGE(log_capture_contains("table"),
                             "the 'table' library must be visible in _ENV");
    TEST_ASSERT_TRUE_MESSAGE(log_capture_contains("string.dump=nil"),
                             "string.dump must be nil within the trimmed string library, not merely "
                             "an error raised at call time");

    /* the never-register / never-open list must be entirely unreachable */
    static const char *k_forbidden[] = {
        "os", "io", "package", "debug", "require", "coroutine",
        "load", "loadfile", "dofile",
    };
    for (size_t i = 0; i < sizeof(k_forbidden) / sizeof(k_forbidden[0]); i++) {
        TEST_ASSERT_FALSE_MESSAGE(log_capture_contains(k_forbidden[i]), k_forbidden[i]);
    }

    odk_sandbox_destroy(sb);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_script_calling_a_non_whitelisted_global_is_contained_to_the_call);
    RUN_TEST(test_script_exceeding_the_instruction_budget_is_terminated_for_that_call);
    RUN_TEST(test_script_exceeding_the_memory_budget_raises_a_recoverable_oom);
    RUN_TEST(test_precompiled_bytecode_is_rejected);
    RUN_TEST(test_string_dump_is_not_available);
    RUN_TEST(test_script_env_sees_only_the_whitelist_env_preload_isolation);
    return UNITY_END();
}
