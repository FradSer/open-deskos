/*
 * lv_conf.h — LVGL configuration for the native open-deskos simulator.
 *
 * The display color format is forced to RGB565 at runtime by lua_lvgl_runtime
 * (lua_lvgl_runtime.c:831), so LV_COLOR_DEPTH is set to 16 to match the
 * px_map the flush callback hands to esp_lcd_panel_draw_bitmap (-> SDL).
 *
 * Mirrors the web sim's lv_conf.h for the parts the AIODI launcher needs:
 * tiny_ttf font loading (aiodi.lua loads fonts/NotoSansSC-Regular.ttf),
 * the Montserrat built-ins (default + fallback font), draw-sw RGB565/XRGB8888
 * support, perf/sysmon/observer off (host-side, not a perf target).
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#ifndef LV_CONF_H
#define LV_CONF_H

/* ----------------------------------------------------------------- color */
#define LV_COLOR_DEPTH 16

/* ----------------------------------------------------------------- memory */
#define LV_USE_STDLIB_MALLOC  LV_STDLIB_CLIB
#define LV_USE_STDLIB_STRING   LV_STDLIB_CLIB
#define LV_USE_STDLIB_SPRINTF  LV_STDLIB_CLIB
#define LV_MEM_SIZE            (4 * 1024 * 1024U)

/* ----------------------------------------------------------------- OS */
#define LV_USE_OS   LV_OS_NONE

/* ----------------------------------------------------------------- ticks */
#define LV_DEF_REFR_PERIOD  16   /* ms — ~60fps */

/* -------------------------------------------------------------- draw units */
#define LV_USE_DRAW        1
#define LV_USE_DRAW_SW     1
#define LV_DRAW_SW_DRAW_UNIT_CNT 1
#define LV_DRAW_SW_COMPLEX 1
#define LV_DRAW_SW_SHADOW_CACHE_SIZE 0
#define LV_DRAW_SW_CIRCLE_CACHE_SIZE 4
#define LV_USE_DRAW_SW_ASM LV_DRAW_SW_ASM_NONE

#define LV_DRAW_SW_SUPPORT_RGB565   1
#define LV_DRAW_SW_SUPPORT_RGB565A8 1
#define LV_DRAW_SW_SUPPORT_RGB888   1
#define LV_DRAW_SW_SUPPORT_XRGB8888 1
#define LV_DRAW_SW_SUPPORT_ARGB8888 1
#define LV_DRAW_SW_SUPPORT_L8        1
#define LV_DRAW_SW_SUPPORT_AL88      1
#define LV_DRAW_SW_SUPPORT_A8        1
#define LV_DRAW_SW_SUPPORT_I1        1
#define LV_DRAW_SW_I1_LUM_THRESHOLD 127

/* ----------------------------------------------------------------- log */
#define LV_USE_LOG 1
#if LV_USE_LOG
#define LV_LOG_LEVEL LV_LOG_LEVEL_WARN
#define LV_LOG_PRINTF 1
#endif

/* --------------------------------------------------------------- assert */
#define LV_USE_ASSERT_NULL          1
#define LV_USE_ASSERT_MALLOC        1
#define LV_USE_ASSERT_MEM_INTEGRITY 0

/* --------------------------------------------------------------- themes */
#define LV_USE_THEME_DEFAULT 1
#define LV_USE_THEME_BASIC   1

/* ----------------------------------------------------------------- fonts */
#define LV_FONT_MONTSERRAT_8  1
#define LV_FONT_MONTSERRAT_10 1
#define LV_FONT_MONTSERRAT_12 1
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_16 1
#define LV_FONT_MONTSERRAT_18 1
#define LV_FONT_MONTSERRAT_20 1
#define LV_FONT_MONTSERRAT_22 1
#define LV_FONT_MONTSERRAT_24 1
#define LV_FONT_MONTSERRAT_26 1
#define LV_FONT_MONTSERRAT_28 1
#define LV_FONT_MONTSERRAT_32 1
#define LV_FONT_MONTSERRAT_40 1
#define LV_FONT_MONTSERRAT_48 1
/* Must track CONFIG_LV_FONT_DEFAULT_MONTSERRAT_28 on the Guition board: the
 * ICONS.* glyphs only exist in the built-in font and the binding exposes no way
 * to pick a size for it, so the default font IS the icon size. Leaving this at
 * 14 made every icon in a sim screenshot half the size it renders on device. */
#define LV_FONT_DEFAULT &lv_font_montserrat_28
#define LV_USE_FONT_PLACEHOLDER 1

/* tiny_ttf — aiodi.lua loads fonts/NotoSansSC-Regular.ttf via lvgl.font_load */
#define LV_USE_FREETYPE 0
#define LV_USE_TINY_TTF 1
#if LV_USE_TINY_TTF
#define LV_TINY_TTF_FILE_SUPPORT 1
#define LV_TINY_TTF_CACHE_GLYPH_CNT 256
#endif

/* SVG icons (aiodi.svg_icon) — needs vector draw via ThorVG */
#define LV_USE_FLOAT 1
#define LV_USE_MATRIX 1
#define LV_USE_VECTOR_GRAPHIC 1
#define LV_USE_THORVG_INTERNAL 1
#define LV_USE_THORVG_EXTERNAL 0
#define LV_USE_SVG 1
#define LV_USE_SVG_ANIMATION 0
#define LV_USE_SVG_DEBUG 0

/* ------------------------------------------------------------- filesystem */
#define LV_USE_FS 1
#if LV_USE_FS
#define LV_FS_stdio 1
#if LV_FS_stdio
#define LV_FS_stdio_LETTER 'A'
#define LV_FS_stdio_CACHE_SIZE 0
#endif
#endif

/* ----------------------------------------------------------- monitors */
#define LV_USE_PERF_MONITOR 0
#define LV_USE_SYSMON 0
#define LV_USE_OBSERVER 1

/* ----------------------------------------------------------------- misc */
#define LV_USE_OBJXNAME 1
#define LV_USE_SNAPSHOT 1

#endif /* LV_CONF_H */
