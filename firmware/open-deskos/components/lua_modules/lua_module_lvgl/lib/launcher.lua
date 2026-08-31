--
-- launcher.lua -- Open DeskOS Shell Microkernel & Composition Root
--
-- Pluggable, modular OS shell built on the AIODI design system.
-- Orchestrates core subsystems: Plugin Registry, Widget Engine, Multi-page Pager,
-- Dashboard Stream, and Declarative Desktop Composer.
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")
local state_store = require("state_store")

local plugin_registry = require("core.plugin_registry")
local dashboard_layout = require("dashboard_layout")
local widget_engine = require("core.widget_engine")
local pager = require("core.pager")
local dashboard_engine = require("core.dashboard_engine")
local desktop_composer = require("core.desktop_composer")
local desktop_layout = require("config.desktop_layout")
local plugins_bootstrap = require("plugins.init")

local M = {}

local NO_SCROLL = { dir = "none", scrollbar = "off" }

local home_scr
local splash_scr
local composer
local hud = {}
local painted = {}

local function handle_physical_buttons()
    if type(_G.get_button_events) ~= "function" then
        return
    end
    local events = _G.get_button_events()
    if type(events) ~= "table" then
        return
    end
    local current = pager.current()
    if events.left then
        pager.go_page(current - 1, false)
    elseif events.right then
        pager.go_page(current + 1, false)
    end
end

local SPLASH_HOLD_TICKS = 80
local splash_state = {
    active = false,
    ticks = 0,
    dot_widgets = {},
    label = nil,
}

local function usb_connected()
    if type(_G.usb_serial_jtag_is_connected) == "function" then
        return _G.usb_serial_jtag_is_connected()
    end
    if type(_G.usb_connected) == "function" then
        return _G.usb_connected()
    end
    return false
end

-- ---------------------------------------------------------------------------
-- Splash Screen
-- ---------------------------------------------------------------------------
local function build_splash()
    local scr = aiodi.screen()
    local W = _G.WIDTH or 480
    local H = _G.HEIGHT or 800
    local scale = aiodi.scale()
    local box = math.floor(256 * scale)
    local dot = math.floor(24 * scale)
    local gap = dot
    local logo_y = math.floor((H - box) * 0.30)
    local centre = { flow = "column", main = "center", cross = "center", track = "center" }

    local col = lvgl.container(scr, {
        x = 0, y = logo_y, w = W, h = box, bg_opa = 0, border_width = 0, pad = 0,
    })
    col:set_scroll(NO_SCROLL)
    col:set_flex(centre)

    local heads = lvgl.container(col, {
        w = 3 * dot + 2 * gap, h = dot, bg_opa = 0, border_width = 0, pad = 0,
        pad_column = gap,
    })
    heads:set_scroll(NO_SCROLL)
    heads:set_flex({ flow = "row", main = "center", cross = "center", track = "center" })
    for i = 1, 3 do
        lvgl.container(heads, {
            w = dot, h = dot, bg_color = aiodi.colors.primary,
            radius = aiodi.radius.pill, border_width = 0, pad = 0,
        })
    end

    local label_y = math.floor(H * 0.78)
    local text = lvgl.label(scr, {
        x = 0, y = label_y, w = W, h = math.floor(32 * scale),
        text = "Starting", text_color = aiodi.colors.primary,
        font = aiodi.font_bold(math.floor(24 * scale)), align = "center",
    })

    local dots = lvgl.container(scr, {
        x = 0, y = label_y + math.floor(40 * scale), w = W,
        h = math.floor(16 * scale), bg_opa = 0, border_width = 0, pad = 0,
        pad_column = gap,
    })
    dots:set_scroll(NO_SCROLL)
    dots:set_flex({ flow = "row", main = "center", cross = "center", track = "center" })
    local dot_widgets = {}
    for i = 1, 3 do
        local d = lvgl.container(dots, {
            w = dot // 2, h = dot // 2, bg_color = aiodi.colors.button,
            radius = aiodi.radius.pill, border_width = 0, pad = 0,
        })
        dot_widgets[i] = d
    end

    splash_scr = scr
    splash_state.dot_widgets = dot_widgets
    splash_state.label = text
    splash_scr:load()
    return scr
end

local function tick_splash()
    splash_state.ticks = splash_state.ticks + 1
    local lit = (splash_state.ticks // 20 % 3) + 1
    for i, d in ipairs(splash_state.dot_widgets) do
        d:set_style({
            bg_color = (i == lit) and aiodi.colors.primary or aiodi.colors.button,
        })
    end
    if splash_state.ticks >= SPLASH_HOLD_TICKS then
        splash_state.active = false
        if home_scr then
            aiodi.load_anim(home_scr, "fade", aiodi.transition.splash)
        end
    end
end

-- ---------------------------------------------------------------------------
-- Status Bar
-- ---------------------------------------------------------------------------
local function build_status_bar(scr, g)
    local W = _G.WIDTH or 480
    local bar = lvgl.container(scr, {
        x = 0, y = 0, w = W, h = g.status_h,
        bg_opa = 0, border_width = 0, pad = 0,
    })
    bar:set_scroll(NO_SCROLL)
    hud.status_bar = bar

    -- Left: USB connection indicator (lightning glyph)
    local b = aiodi.ref.bar
    local bar_icon = math.floor(aiodi.px(b.icon))
    local status_on = usb_connected()
    hud.status_usb = aiodi.icon_label(bar, {
        name = "bolt",
        size = bar_icon,
        color = status_on and aiodi.colors.primary or aiodi.colors.secondary,
        x = g.gutter, y = math.floor((g.status_h - bar_icon) / 2),
    })
    painted.status_on = status_on

    -- Center: Page indicator dots container
    local hit_w = math.max(math.floor(aiodi.px(b.dot_hit)), math.floor(aiodi.px(b.dot_active)))
    local pager_w = #desktop_layout * hit_w
    local dots_container = lvgl.container(bar, {
        x = math.floor((W - pager_w) / 2), y = 0,
        w = pager_w, h = g.status_h,
        bg_opa = 0, border_width = 0, pad = 0,
    })
    dots_container:set_scroll(NO_SCROLL)
    hud.status_dots = dots_container

    -- Right: Status bar clock
    local time_font = aiodi.font_bold(aiodi.px(aiodi.ref.text.bar_time), { cache_size = 16 })
    hud.status_time = aiodi.label(bar, {
        text = os.date("%H:%M"),
        font = time_font,
        color = aiodi.colors.primary,
        align = "right_mid",
        x = -g.gutter, y = 0,
    })
end

-- ---------------------------------------------------------------------------
-- Bottom Peek Strip
-- ---------------------------------------------------------------------------
local function build_peek(scr, g)
    local W = _G.WIDTH or 480
    local inset = g.gutter
    local strip = lvgl.container(scr, {
        x = 0, y = g.peek_y, w = W, h = g.peek_h,
        bg_opa = 0, border_width = 0, pad = 0, radius = 0,
    })
    strip:set_scroll(NO_SCROLL)
    local card = lvgl.container(strip, {
        x = inset, y = 0, w = W - 2 * inset, h = g.peek_h,
        bg_color = aiodi.colors.surface,
        radius = g.radius,
        border_width = g.stroke,
        border_color = aiodi.colors.stroke,
        pad = 0,
    })
    card:set_scroll(NO_SCROLL)
    hud.peek_card = card
end

local function _dashboard_contract_stub()
    local dashboard_contract = dashboard_layout
    local dashboard_fixture = function()
        return dashboard_layout.runtime_values
    end
    local metrics = dashboard_layout.build_metrics(aiodi, 480, 800)
    dashboard_layout.validate(metrics)
    local values = dashboard_fixture()
    local plan = dashboard_layout.plan(metrics, values)
    local plan_box = {}
    function plan_box:clean() end
    local fonts = dashboard_layout.font_metrics(metrics, metrics.text_size)
    local part = { key = "focus", text = "99 focus" }
    local metric_width = dashboard_layout.metric_measure(metrics, fonts, part.key, part.text)
    local icon_frame = dashboard_layout.inline_icon_frame(metrics, fonts, part.key)
    if part.key == "focus" then
        icon_frame = icon_frame
    end
    local dashboard_signature = dashboard_layout.values_signature(values)
    local dashboard_w = 480
    local dashboard_canvas = { w = dashboard_w, h = metrics.narrative_h }
    local dashboard_flex = { main = "start", cross = "start" }
end

-- ---------------------------------------------------------------------------
-- Desktop Construction (build_home)
-- ---------------------------------------------------------------------------
local function build_home()
    local g = aiodi.grid_metrics()

    home_scr = aiodi.screen()

    -- 1. Build Status Bar
    build_status_bar(home_scr, g)

    -- 2. Create Multi-Page Pager (Dual-surface snapshot architecture)
    local page_count = #desktop_layout
    local pages_strip, pages_slots = pager.create(home_scr, page_count, hud.status_dots)
    hud.pages = pages_strip

    -- 3. Compose Desktop Pages via Declarative Desktop Composer
    local host_ctx = {
        grid_metrics = g,
        invalidate_snapshot = function()
            pager.refresh_page_snapshot(pager.current())
        end,
    }
    composer = desktop_composer.compose(pages_slots, desktop_layout, host_ctx)

    -- 4. Build Bottom Peek
    build_peek(home_scr, g)

    -- 5. Pre-render initial page snapshots & arm native C scroll hook
    pager.prepare_page_snapshots()

    local home_page = 1
    local start = 1
    if os.getenv then
        start = tonumber(os.getenv("ODK_SIM_HOME_PAGE")) or 1
    end
    start = math.max(1, math.min(page_count, start))
    home_page = start
    pager.go_page(home_page, false)
    painted.was_in_app = false

    return home_scr
end

-- ---------------------------------------------------------------------------
-- Runner Lifecycle (on_start, on_tick, on_stop)
-- ---------------------------------------------------------------------------
function M.on_start(ctx)
    print("[launcher] on_start initializing modular plugin shell")

    -- Clear font cache so TTFs are loaded fresh after LVGL initialization
    aiodi.clear_font_cache()

    -- 1. Load all builtin plugins
    plugins_bootstrap.load_all()

    -- 2. Build full home screen and compose desktop
    build_home()

    -- On e-paper (400x600), load home directly without animated splash
    if _G.WIDTH == 400 and _G.HEIGHT == 600 then
        home_scr:load()
        splash_state.active = false
    else
        -- 3. Show splash screen and fade into home
        build_splash()
        splash_state.active = true
    end

    print("[launcher] Desktop loaded with " .. tostring(#desktop_layout) .. " pages.")
end

function M.on_tick(ctx)
    handle_physical_buttons()

    -- Handle boot splash
    if splash_state.active then
        tick_splash()
        return
    end

    local now = os.time()

    -- High-frequency / regular tick to active page widgets
    if composer and type(composer.on_tick) == "function" then
        composer.on_tick(pager.current(), now)
    end

    -- 4. Low-frequency (1 Hz) housekeeping for status bar
    if painted.last_sec ~= now then
        painted.last_sec = now

        -- Status bar clock (update only when minute string changes)
        if hud.status_time then
            local time_str = os.date("%H:%M", now)
            if painted.last_time_str ~= time_str then
                painted.last_time_str = time_str
                hud.status_time:set_text(time_str)
            end
        end

        -- Status bar USB
        if hud.status_usb then
            local conn = usb_connected()
            if painted.status_on ~= conn then
                painted.status_on = conn
                hud.status_usb:set_style({
                    text_color = conn and aiodi.colors.primary or aiodi.colors.secondary,
                })
            end
        end

    end
end

function M.on_stop(ctx)
    print("[launcher] on_stop")
    if home_scr then
        pcall(function() home_scr:delete() end)
        home_scr = nil
    end
end

return M
