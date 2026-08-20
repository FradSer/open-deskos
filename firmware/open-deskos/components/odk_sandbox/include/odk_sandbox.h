/*
 * odk_sandbox.h — hardened Lua sandbox (architecture §4.2, five measures).
 *
 * esp-claw's own sandbox is not inheritable: cap_lua_runtime.c calls
 * luaL_openlibs() directly, which opens io/os/package/debug/coroutine/require
 * unconditionally (Discovery #5). This component builds a sandbox from zero
 * instead of hardening that call site: a dedicated allocator, an instruction-
 * count hook, a preload _ENV, and a whitelist-only C API surface. It never
 * calls luaL_openlibs().
 *
 * Zero IDF include: the memory pool is supplied by the caller (target-side
 * PSRAM block, host-side static buffer), so this header and its
 * implementation compile unchanged on the host test harness and on-target.
 *
 * NFR-4 binding audit: the instruction-count hook (measure 2) fires only at
 * vmfetch, so a C binding that busy-loops or blocks bypasses it entirely.
 * Every odk_api_reg_t.fn registered here MUST therefore be O(1) and
 * non-blocking; the TWDT stays armed as the only backstop for a wedged C
 * call. Each binding receives api_ctx as upvalue(1)
 * (lua_touserdata(L, lua_upvalueindex(1))). The sandbox's own internal
 * metamethod handlers and count hook are all O(1)/non-blocking.
 */
#ifndef ODK_SANDBOX_H
#define ODK_SANDBOX_H

#include <stddef.h>
#include <stdint.h>

#include "odk_err.h"

typedef struct {
    void    *pool;           /* caller-owned dedicated pool buffer */
    size_t   pool_size;       /* 64-128KB (NFR-3) */
    uint32_t instr_budget;    /* LUA_MASKCOUNT instruction budget */
} odk_sandbox_limits_t;

typedef struct lua_State lua_State;
typedef struct { const char *name; int (*fn)(lua_State *L); } odk_api_reg_t;
typedef struct odk_sandbox odk_sandbox_t;

odk_sandbox_t *odk_sandbox_create(const odk_sandbox_limits_t *lim,
                                    const odk_api_reg_t *api, size_t n_api,
                                    void *api_ctx);

/* Text chunks only (mode="t"); the loaded chunk's _ENV is the preload-env
 * whitelist table (whitelist C bindings + trimmed base/string/math/table). */
odk_err_t odk_sandbox_load_source(odk_sandbox_t *sb, const char *src,
                                    size_t len, const char *chunkname);

/* Calls a global function defined by the loaded chunk. A violation, OOM, or
 * instruction-budget overrun returns an error and fills errbuf; the
 * lua_State stays alive and a later call on the same handle can still
 * succeed. */
odk_err_t odk_sandbox_call(odk_sandbox_t *sb, const char *global_fn,
                             char *errbuf, size_t errlen);

void odk_sandbox_destroy(odk_sandbox_t *sb);

/* Compile-only check (mode="t", never executed) — reused by task-008's
 * generation pipeline to validate generated scripts before packaging. */
odk_err_t odk_sandbox_check_source(const char *src, size_t len,
                                     char *errbuf, size_t errlen);

#endif /* ODK_SANDBOX_H */
