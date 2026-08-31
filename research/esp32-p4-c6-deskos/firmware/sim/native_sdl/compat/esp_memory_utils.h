/*
 * esp_memory_utils.h — host shim. lua_lvgl_runtime.c uses heap_caps_aligned_alloc
 * (for draw buffers) and esp_ptr_internal (a heap-region predicate). The host
 * has no PSRAM/internal-SRAM split, so aligned_alloc delegates to the libc
 * and esp_ptr_internal returns true (everything is "internal" on the host).
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdlib.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

static inline void *heap_caps_aligned_alloc(size_t alignment, size_t size, int caps)
{
    (void)caps;
#if defined(_MSC_VER)
    (void)alignment;
    return malloc(size);
#else
    void *ptr = NULL;
    if (posix_memalign(&ptr, alignment, size) != 0) {
        return NULL;
    }
    return ptr;
#endif
}

static inline void heap_caps_aligned_free(void *ptr)
{
    free(ptr);
}

static inline bool esp_ptr_internal(const void *ptr)
{
    (void)ptr;
    return true;
}

#ifdef __cplusplus
}
#endif
