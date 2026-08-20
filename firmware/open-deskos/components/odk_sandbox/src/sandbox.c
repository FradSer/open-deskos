/*
 * sandbox.c — hardened Lua 5.5 sandbox (architecture §4.2, five measures).
 *
 * The five measures, all wired below:
 *   1. Budget allocator (lua_setallocf): a first-fit free-list carved out of
 *      the caller-owned pool buffer. When a request cannot be satisfied the
 *      allocator returns NULL — it never abort()s — so Lua raises a
 *      pcall-recoverable LUA_ERRMEM (the allocator-null-contract).
 *   2. Instruction-count hook (lua_sethook / LUA_MASKCOUNT): re-armed at the
 *      start of every call from limits.instr_budget; on overrun it raises,
 *      aborting only that one call. Blind spot: the hook fires only at
 *      vmfetch, so a C binding that busy-loops bypasses it — every registered
 *      C binding MUST be O(1)/non-blocking (see the audit note in the header).
 *   3. Preload-env isolation (_ENV): user source is loaded text-only and its
 *      _ENV upvalue is repointed at a host-built whitelist table, so the
 *      script sees ONLY whitelisted names.
 *   4. Whitelist-only C registration: only the caller-supplied odk_api_reg_t
 *      entries are installed, into the env table, each as a closure carrying
 *      api_ctx as upvalue(1) (bindings read it via lua_upvalueindex(1)).
 *   5. Trimmed stdlib: only base (minus load/loadfile/dofile/collectgarbage/
 *      _G), string (minus dump), math and table are opened individually via
 *      luaL_requiref. The all-libraries opener is never invoked, so
 *      io/os/package/debug/coroutine/require are unreachable.
 *
 * Internal metamethod handlers (env __index raiser, string __index blocker,
 * nil __call blocker) and the count hook are all O(1)/non-blocking, so they do
 * not widen measure 2's blind spot.
 *
 * Zero IDF include: only Lua headers and libc. The memory pool is caller-
 * supplied, so this unit compiles unchanged on host and on target.
 */
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"

#include "odk_sandbox.h"

/* ---------------------------------------------------------------------------
 * Measure 1: budget allocator over the caller-owned pool.
 *
 * The pool is partitioned into blocks kept in an address-ordered doubly linked
 * list; alloc is first-fit with splitting, free coalesces with both physical
 * neighbours. Because every block lives inside the fixed pool buffer, the hard
 * memory ceiling is exactly pool_size — an over-budget request simply finds no
 * fitting block and returns NULL.
 * ------------------------------------------------------------------------- */

#define ODK_ALIGN 16u
#define ODK_ALIGN_UP(n) (((n) + (ODK_ALIGN - 1u)) & ~((size_t)ODK_ALIGN - 1u))

typedef struct pblk {
    size_t        size;  /* usable payload bytes (excludes this header) */
    struct pblk  *prev;  /* physically previous block, or NULL */
    struct pblk  *next;  /* physically next block, or NULL */
    unsigned      used;  /* 1 = handed out, 0 = free */
} pblk_t;

typedef struct {
    pblk_t *first;
} odk_pool_t;

#define ODK_HDR ODK_ALIGN_UP(sizeof(pblk_t))
#define ODK_POOL_MIN (ODK_HDR + ODK_ALIGN)

static int pool_init(odk_pool_t *p, void *buf, size_t size)
{
    uintptr_t raw = (uintptr_t)buf;
    uintptr_t base = ODK_ALIGN_UP(raw);
    size_t head = (size_t)(base - raw);
    if (size < head + ODK_POOL_MIN) {
        return 0;
    }
    pblk_t *b = (pblk_t *)base;
    b->size = size - head - ODK_HDR;
    b->prev = NULL;
    b->next = NULL;
    b->used = 0;
    p->first = b;
    return 1;
}

static void pool_split(pblk_t *b, size_t want)
{
    /* Carve a trailing free block only if what remains can hold a header plus
     * a minimally useful payload. */
    if (b->size < want + ODK_HDR + ODK_ALIGN) {
        return;
    }
    pblk_t *tail = (pblk_t *)((char *)b + ODK_HDR + want);
    tail->size = b->size - want - ODK_HDR;
    tail->used = 0;
    tail->prev = b;
    tail->next = b->next;
    if (b->next) {
        b->next->prev = tail;
    }
    b->next = tail;
    b->size = want;
    if (tail->next && !tail->next->used) {
        pblk_t *nx = tail->next;
        tail->size += ODK_HDR + nx->size;
        tail->next = nx->next;
        if (nx->next) {
            nx->next->prev = tail;
        }
    }
}

static void *pool_alloc(odk_pool_t *p, size_t want)
{
    want = want ? ODK_ALIGN_UP(want) : ODK_ALIGN;
    for (pblk_t *b = p->first; b; b = b->next) {
        if (!b->used && b->size >= want) {
            pool_split(b, want);
            b->used = 1;
            return (char *)b + ODK_HDR;
        }
    }
    return NULL;
}

static void pool_free(odk_pool_t *p, void *ptr)
{
    if (!ptr) {
        return;
    }
    pblk_t *b = (pblk_t *)((char *)ptr - ODK_HDR);
    b->used = 0;
    if (b->next && !b->next->used) {
        pblk_t *nx = b->next;
        b->size += ODK_HDR + nx->size;
        b->next = nx->next;
        if (nx->next) {
            nx->next->prev = b;
        }
    }
    if (b->prev && !b->prev->used) {
        pblk_t *pv = b->prev;
        pv->size += ODK_HDR + b->size;
        pv->next = b->next;
        if (b->next) {
            b->next->prev = pv;
        }
    }
    (void)p;
}

static void *pool_realloc(odk_pool_t *p, void *ptr, size_t want)
{
    if (!ptr) {
        return pool_alloc(p, want);
    }
    if (want == 0) {
        pool_free(p, ptr);
        return NULL;
    }
    want = ODK_ALIGN_UP(want);
    pblk_t *b = (pblk_t *)((char *)ptr - ODK_HDR);
    if (b->size >= want) {
        pool_split(b, want);
        return ptr;
    }
    /* Grow in place by absorbing an adjacent free successor. */
    if (b->next && !b->next->used && b->size + ODK_HDR + b->next->size >= want) {
        pblk_t *nx = b->next;
        b->size += ODK_HDR + nx->size;
        b->next = nx->next;
        if (nx->next) {
            nx->next->prev = b;
        }
        pool_split(b, want);
        return ptr;
    }
    /* Relocate. On failure Lua keeps the old pointer, so the OOM is
     * recoverable rather than fatal. */
    void *np = pool_alloc(p, want);
    if (!np) {
        return NULL;
    }
    memcpy(np, ptr, b->size);
    pool_free(p, ptr);
    return np;
}

static void *pool_allocf(void *ud, void *ptr, size_t osize, size_t nsize)
{
    (void)osize;
    odk_pool_t *p = (odk_pool_t *)ud;
    if (nsize == 0) {
        pool_free(p, ptr);
        return NULL;
    }
    return pool_realloc(p, ptr, nsize);
}

/* ---------------------------------------------------------------------------
 * Sandbox handle and per-state back-reference.
 * ------------------------------------------------------------------------- */

struct odk_sandbox {
    odk_pool_t pool;
    lua_State  *L;
    int         env_ref;      /* registry ref to the whitelist _ENV table */
    uint32_t    instr_budget;
    void       *api_ctx;
    int         budget_hit;   /* set by the count hook, read after pcall */
    char        blocked_name[64]; /* qualified name of the last blocked field */
    const odk_api_reg_t *init_api;
    size_t                init_n;
};

static odk_sandbox_t *get_sb(lua_State *L)
{
    return *(odk_sandbox_t **)lua_getextraspace(L);
}

/* ---------------------------------------------------------------------------
 * Measure 2: instruction-count hook.
 * ------------------------------------------------------------------------- */

static void instr_hook(lua_State *L, lua_Debug *ar)
{
    (void)ar;
    get_sb(L)->budget_hit = 1;
    luaL_error(L, "instruction budget exceeded");
}

static void arm_hook(odk_sandbox_t *sb)
{
    sb->budget_hit = 0;
    sb->blocked_name[0] = '\0';
    if (sb->instr_budget > 0 && sb->instr_budget <= (uint32_t)INT_MAX) {
        lua_sethook(sb->L, instr_hook, LUA_MASKCOUNT, (int)sb->instr_budget);
    } else if (sb->instr_budget > (uint32_t)INT_MAX) {
        lua_sethook(sb->L, instr_hook, LUA_MASKCOUNT, INT_MAX);
    } else {
        lua_sethook(sb->L, NULL, 0, 0);
    }
}

/* ---------------------------------------------------------------------------
 * Measure 3/4/5: whitelist env, trimmed stdlib, blocked-name messaging.
 * ------------------------------------------------------------------------- */

/* __index of the whitelist _ENV: any name the script did not receive raises a
 * script-author-facing "<name> is not available". Only reached from inside a
 * script call (host-side fetches use rawget), so raising here is always
 * protected by the enclosing pcall. */
static int env_index_raise(lua_State *L)
{
    const char *key = lua_tostring(L, 2);
    return luaL_error(L, "%s is not available", key ? key : "value");
}

/* __index of the trimmed string library: a removed member (e.g. dump) reads
 * back as nil so `string.dump == nil` holds, while the qualified name is
 * recorded so that *calling* the nil value can name it precisely. upvalue(1)
 * is the library name. */
static int lib_index_block(lua_State *L)
{
    odk_sandbox_t *sb = get_sb(L);
    const char *lib = lua_tostring(L, lua_upvalueindex(1));
    const char *key = lua_tostring(L, 2);
    if (lib && key) {
        snprintf(sb->blocked_name, sizeof(sb->blocked_name), "%s.%s", lib, key);
    }
    lua_pushnil(L);
    return 1;
}

/* __call of the nil type: calling a removed member surfaces the qualified
 * "<lib>.<member> is not available" message recorded by lib_index_block. */
static int nil_call_block(lua_State *L)
{
    odk_sandbox_t *sb = get_sb(L);
    if (sb->blocked_name[0] != '\0') {
        char name[sizeof(sb->blocked_name)];
        snprintf(name, sizeof(name), "%s", sb->blocked_name);
        sb->blocked_name[0] = '\0';
        return luaL_error(L, "%s is not available", name);
    }
    return luaL_error(L, "attempt to call a nil value");
}

/* Base functions safe to expose. Deliberately excludes load/loadfile/dofile/
 * collectgarbage/_G (measure 5) and never includes require/io/os/package/
 * debug/coroutine (never opened). */
static const char *const k_safe_base[] = {
    "assert",  "error",         "ipairs",     "next",       "pairs",
    "pcall",   "print",         "rawequal",   "rawget",     "rawlen",
    "rawset",  "select",        "setmetatable", "getmetatable", "tonumber",
    "tostring", "type",         "xpcall",     "_VERSION",
};

/* Runs under lua_pcall so any allocation failure during setup unwinds to a
 * clean create() failure instead of aborting. */
static int sandbox_init(lua_State *L)
{
    odk_sandbox_t *sb = get_sb(L);

    luaL_requiref(L, LUA_GNAME, luaopen_base, 1);
    lua_pop(L, 1);
    luaL_requiref(L, LUA_STRLIBNAME, luaopen_string, 1);
    lua_pop(L, 1);
    luaL_requiref(L, LUA_MATHLIBNAME, luaopen_math, 1);
    lua_pop(L, 1);
    luaL_requiref(L, LUA_TABLIBNAME, luaopen_table, 1);
    lua_pop(L, 1);

    /* Trim string.dump on the real library table (this table also backs string
     * value methods, so removing it here closes ("x"):dump() as well) and give
     * it the blocked-name metatable. */
    lua_getglobal(L, "string");
    lua_pushnil(L);
    lua_setfield(L, -2, "dump");
    lua_createtable(L, 0, 1);
    lua_pushstring(L, "string");
    lua_pushcclosure(L, lib_index_block, 1);
    lua_setfield(L, -2, "__index");
    lua_setmetatable(L, -2);
    lua_pop(L, 1);

    /* Build the whitelist _ENV table. */
    lua_newtable(L);
    int env = lua_gettop(L);

    for (size_t i = 0; i < sizeof(k_safe_base) / sizeof(k_safe_base[0]); i++) {
        lua_getglobal(L, k_safe_base[i]);
        lua_setfield(L, env, k_safe_base[i]);
    }
    lua_getglobal(L, "string");
    lua_setfield(L, env, "string");
    lua_getglobal(L, "math");
    lua_setfield(L, env, "math");
    lua_getglobal(L, "table");
    lua_setfield(L, env, "table");

    /* Measure 4: whitelist-only C registration, api_ctx as upvalue(1). */
    for (size_t i = 0; i < sb->init_n; i++) {
        if (!sb->init_api[i].name || !sb->init_api[i].fn) {
            continue;
        }
        lua_pushlightuserdata(L, sb->api_ctx);
        lua_pushcclosure(L, sb->init_api[i].fn, 1);
        lua_setfield(L, env, sb->init_api[i].name);
    }

    /* _ENV metatable: unknown names raise instead of reading back nil. */
    lua_createtable(L, 0, 1);
    lua_pushcfunction(L, env_index_raise);
    lua_setfield(L, -2, "__index");
    lua_setmetatable(L, env);

    lua_pushvalue(L, env);
    sb->env_ref = luaL_ref(L, LUA_REGISTRYINDEX);

    /* nil-type metatable so a removed-member call is named precisely. */
    lua_pushnil(L);
    lua_createtable(L, 0, 1);
    lua_pushcfunction(L, nil_call_block);
    lua_setfield(L, -2, "__call");
    lua_setmetatable(L, -2);
    lua_pop(L, 1);

    lua_settop(L, 0);
    return 0;
}

/* ---------------------------------------------------------------------------
 * Public API.
 * ------------------------------------------------------------------------- */

odk_sandbox_t *odk_sandbox_create(const odk_sandbox_limits_t *lim,
                                    const odk_api_reg_t *api, size_t n_api,
                                    void *api_ctx)
{
    if (!lim || !lim->pool || lim->pool_size < ODK_POOL_MIN) {
        return NULL;
    }

    odk_sandbox_t *sb = calloc(1, sizeof(*sb));
    if (!sb) {
        return NULL;
    }
    if (!pool_init(&sb->pool, lim->pool, lim->pool_size)) {
        free(sb);
        return NULL;
    }
    sb->instr_budget = lim->instr_budget;
    sb->api_ctx = api_ctx;
    sb->env_ref = LUA_NOREF;

    lua_State *L = lua_newstate(pool_allocf, &sb->pool, 0);
    if (!L) {
        free(sb);
        return NULL;
    }
    sb->L = L;
    *(odk_sandbox_t **)lua_getextraspace(L) = sb;

    sb->init_api = api;
    sb->init_n = n_api;
    lua_pushcfunction(L, sandbox_init);
    int st = lua_pcall(L, 0, 0, 0);
    sb->init_api = NULL;
    sb->init_n = 0;
    if (st != LUA_OK) {
        lua_close(L);
        free(sb);
        return NULL;
    }
    return sb;
}

odk_err_t odk_sandbox_load_source(odk_sandbox_t *sb, const char *src,
                                    size_t len, const char *chunkname)
{
    if (!sb || !src) {
        return ODK_ERR_SANDBOX_VIOLATION;
    }
    lua_State *L = sb->L;
    lua_settop(L, 0);
    lua_gc(L, LUA_GCCOLLECT, 0);

    /* Measure 3: text-only load rejects binary bytecode chunks outright. */
    if (luaL_loadbufferx(L, src, len, chunkname, "t") != LUA_OK) {
        lua_settop(L, 0);
        return ODK_ERR_SANDBOX_VIOLATION;
    }

    /* Repoint _ENV (upvalue 1 of a main chunk) at the whitelist table. */
    lua_rawgeti(L, LUA_REGISTRYINDEX, sb->env_ref);
    if (lua_setupvalue(L, -2, 1) == NULL) {
        lua_settop(L, 0);
        return ODK_ERR_SANDBOX_VIOLATION;
    }

    /* Run the chunk once so its top-level function definitions land in _ENV. */
    arm_hook(sb);
    int st = lua_pcall(L, 0, 0, 0);
    if (st != LUA_OK) {
        odk_err_t e = (st == LUA_ERRMEM)                     ? ODK_ERR_OOM
                       : (st == LUA_ERRRUN && sb->budget_hit) ? ODK_ERR_BUDGET_EXCEEDED
                                                              : ODK_ERR_SANDBOX_VIOLATION;
        lua_settop(L, 0);
        return e;
    }
    lua_settop(L, 0);
    return ODK_OK;
}

odk_err_t odk_sandbox_call(odk_sandbox_t *sb, const char *global_fn,
                             char *errbuf, size_t errlen)
{
    if (errbuf && errlen > 0) {
        errbuf[0] = '\0';
    }
    if (!sb || !global_fn) {
        return ODK_ERR_SANDBOX_VIOLATION;
    }
    lua_State *L = sb->L;
    lua_settop(L, 0);
    /* Reclaim the previous call's garbage so the pool budget is honoured per
     * call rather than accumulating across calls (session continuity). */
    lua_gc(L, LUA_GCCOLLECT, 0);

    /* Fetch the target with rawget to bypass the raising _ENV __index, so a
     * missing function reports NOT_FOUND instead of raising unprotected. */
    lua_rawgeti(L, LUA_REGISTRYINDEX, sb->env_ref);
    lua_pushstring(L, global_fn);
    lua_rawget(L, -2);
    if (lua_type(L, -1) != LUA_TFUNCTION) {
        lua_settop(L, 0);
        if (errbuf && errlen > 0) {
            snprintf(errbuf, errlen, "no such function: %s", global_fn);
        }
        return ODK_ERR_NOT_FOUND;
    }
    lua_remove(L, -2); /* drop the env table, leaving the function on top */

    arm_hook(sb);
    int st = lua_pcall(L, 0, 0, 0);
    if (st != LUA_OK) {
        const char *msg = lua_tostring(L, -1);
        if (errbuf && errlen > 0) {
            if (msg) {
                strncpy(errbuf, msg, errlen - 1);
                errbuf[errlen - 1] = '\0';
            } else {
                errbuf[0] = '\0';
            }
        }
        odk_err_t e = (st == LUA_ERRMEM)                     ? ODK_ERR_OOM
                       : (st == LUA_ERRRUN && sb->budget_hit) ? ODK_ERR_BUDGET_EXCEEDED
                                                              : ODK_ERR_SANDBOX_VIOLATION;
        lua_settop(L, 0);
        return e;
    }
    lua_settop(L, 0);
    return ODK_OK;
}

void odk_sandbox_destroy(odk_sandbox_t *sb)
{
    if (!sb) {
        return;
    }
    if (sb->L) {
        if (sb->env_ref != LUA_NOREF) {
            luaL_unref(sb->L, LUA_REGISTRYINDEX, sb->env_ref);
        }
        lua_close(sb->L);
    }
    free(sb);
}

odk_err_t odk_sandbox_check_source(const char *src, size_t len,
                                     char *errbuf, size_t errlen)
{
    if (errbuf && errlen > 0) {
        errbuf[0] = '\0';
    }
    if (!src) {
        return ODK_ERR_SANDBOX_VIOLATION;
    }
    lua_State *L = luaL_newstate();
    if (!L) {
        return ODK_ERR_OOM;
    }
    odk_err_t r = ODK_OK;
    if (luaL_loadbufferx(L, src, len, "check", "t") != LUA_OK) {
        const char *msg = lua_tostring(L, -1);
        if (errbuf && errlen > 0 && msg) {
            strncpy(errbuf, msg, errlen - 1);
            errbuf[errlen - 1] = '\0';
        }
        r = ODK_ERR_SANDBOX_VIOLATION;
    }
    lua_close(L);
    return r;
}
