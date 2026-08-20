--
-- launcher -- AIODI OS shell: the Figma `Homepage / #1` widget grid, whose
-- tiles open real apps you can always get back out of. Built on the `aiodi`
-- design system. Boots as the on-device UI (see `cerb ui launcher`).
--
-- Runs inside the Shell Lua state. The C Runner owns LVGL initialization and
-- invokes this module through on_start(ctx), on_tick(ctx), and on_stop(ctx).
--
-- The Shell owns the registry, State Store, and the one active UI App. App
-- Runtime callbacks are created on start and destroyed on stop; there is no
-- cached app frame and no App-owned screen navigation.
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")
local state_store = require("state_store")

local M = {}
local builtin_module

-- The resident Shell screen. Hero App frames are mounted above it and destroyed
-- after their reverse transition. The real tapped widget is promoted above a
-- geometric surface for the early part of the transition; it is never cloned
-- or scaled as an image. App Center still uses a conventional screen load
-- because it has no source widget rectangle.
local home

-- Canonical UI App Manager state. This is intentionally small because Runtime
-- lifecycle and resource ownership live behind these functions.
local app_manager = {
    phase = "shell",
    active_id = nil,
    runtime = nil,
}

-- Hero navigation is owned by the Shell, not by an App. `source_rect` is a
-- copied absolute rectangle, so a page scroll or Peek rebuild cannot invalidate
-- the reverse animation. All values are device pixels.
local transition_phase = "idle"
local HERO_FALLBACK_TICK_MS = 20
local HERO_MAX_TICK_DELTA_MS = 100
local LVGL_TICK_WRAP_MS = 4294967296
local hero = {
    root = nil,
    cover = nil,
    source = nil,
    source_rect = nil,
    elapsed_ms = 0,
    duration_ms = 0,
    opening = false,
    last_tick_ms = nil,
}

-- Home widgets refreshed by tick, and the values they were last painted with:
-- re-setting a label every tick would thrash the display for nothing.
local hud = {}
local painted = {}

-- Bottom peek: the Shell-owned last-opened App id. It is an id, not a registry
-- index, so catalog insertion cannot silently point the peek at another App.
local peek = { app_id = "pomodoro" }

-- Home pager: Homepage/#1 (widget grid), Homepage/#2 (agent quota),
-- Homepage/#3 (App Center). Status-bar dots mirror this count; active = page.
local HOME_PAGE_COUNT = 3
local home_page = 1

-- Fonts, loaded in M.on_start(): font_load requires an initialized LVGL VM.
local fonts = {}

-- Splash -------------------------------------------------------------------
-- The Figma `Homepage / #0 Starting...` boot screen: a brand mark centred on
-- black, "Starting..." beneath it with three dots that chase around. Pure
-- vector (no image asset -- the PNG decoder is off in the sim and there is no
-- Open DeskOS brand PNG anyway). The dots animate off the tick; when the boot
-- hold elapses the launcher swaps to home.
local splash
local splash_state = { active = false, ticks = 0 }

-- Boot hold in ticks, not wall/CPU time. The sim sleeps most of each frame
-- (SDL_Delay), so os.clock() (CPU time) barely advances and the splash never
-- exits; os.time() is only 1 s resolution. The animation already assumes
-- ~5 ms/tick, so 500 ticks ~= 2.5 s on both host and device.
local SPLASH_HOLD_TICKS = 500

-- Cards and their containers never scroll (see the definition near the Home
-- section). Declared early so the splash builder, which runs first, can use it.
local NO_SCROLL

local function build_splash()
    local scr = aiodi.screen()
    local W = _G.WIDTH or 480
    local H = _G.HEIGHT or 800
    local scale = aiodi.scale()
    -- Design: 256px logo box at (32, 52) on 320x480, "Starting..." baseline
    -- ~75px from the bottom. Scale both onto the live panel and centre.
    local box = math.floor(256 * scale)
    local dot = math.floor(24 * scale)
    local gap = dot
    local logo_y = math.floor((H - box) * 0.30)
    local centre = { flow = "column", main = "center", cross = "center", track = "center" }

    local col = lvgl.container(scr, {
        x = 0, y = logo_y, w = W, h = box, bg_opa = 0, border_width = 0, pad = 0 })
    col:set_scroll(NO_SCROLL)
    col:set_flex(centre)

    -- Open DeskOS mark: three heads in a row. Echos the three-dot motif so the
    -- boot screen reads as one system with the bar dots and the chase below.
    local heads = lvgl.container(col, {
        w = 3 * dot + 2 * gap, h = dot, bg_opa = 0, border_width = 0, pad = 0,
        pad_column = gap })
    heads:set_scroll(NO_SCROLL)
    heads:set_flex({ flow = "row", main = "center", cross = "center", track = "center" })
    for i = 1, 3 do
        lvgl.container(heads, {
            w = dot, h = dot, bg_color = aiodi.colors.primary,
            radius = aiodi.radius.pill, border_width = 0, pad = 0 })
    end

    -- "Starting..." + three chasing dots, low on the screen as in the design.
    local label_y = math.floor(H * 0.78)
    local text = lvgl.label(scr, {
        x = 0, y = label_y, w = W, h = math.floor(32 * scale),
        text = "Starting", text_color = aiodi.colors.primary,
        font = aiodi.font_bold(math.floor(24 * scale)), align = "center" })

    local dots = lvgl.container(scr, {
        x = 0, y = label_y + math.floor(40 * scale), w = W,
        h = math.floor(16 * scale), bg_opa = 0, border_width = 0, pad = 0,
        pad_column = gap })
    dots:set_scroll(NO_SCROLL)
    dots:set_flex({ flow = "row", main = "center", cross = "center", track = "center" })
    local dot_widgets = {}
    for i = 1, 3 do
        local d = lvgl.container(dots, {
            w = dot // 2, h = dot // 2, bg_color = aiodi.colors.button,
            radius = aiodi.radius.pill, border_width = 0, pad = 0 })
        dot_widgets[i] = d
    end

    -- Stash handles the tick will mutate.
    splash = scr
    splash_state.dot_widgets = dot_widgets
    splash_state.label = text
    return scr
end

-- Advance the splash animation: one of three dots lit at a time, cycling at
-- roughly 4 Hz (one tick ~= 5 ms, light a new dot every ~250 ms). Swap to
-- home once the boot hold elapses. Driven by the high-rate tick path.
local function tick_splash()
    splash_state.ticks = splash_state.ticks + 1
    local lit = (splash_state.ticks // 50 % 3) + 1
    for i, d in ipairs(splash_state.dot_widgets) do
        d:set_style({ bg_color = (i == lit) and aiodi.colors.primary
                                       or aiodi.colors.button })
    end
    if splash_state.ticks >= SPLASH_HOLD_TICKS then
        splash_state.active = false
        aiodi.load_anim(home, "fade", aiodi.transition.splash)
    end
end

-- Live values ---------------------------------------------------------------

-- Fraction of the year elapsed -- what the design's "Year 73%" bar means.
local function year_progress(now)
    local t = os.date("*t", now)
    local from = os.time({ year = t.year, month = 1, day = 1, hour = 0 })
    local to = os.time({ year = t.year + 1, month = 1, day = 1, hour = 0 })
    return (now - from) / (to - from)
end

-- The design tracks "SPE" wide apart; the binding has no letter-spacing style,
-- so space the glyphs by hand.
local function spaced(s)
    return (s:gsub("(.)", "%1 "):gsub(" $", ""))
end

-- Built-in App modules ------------------------------------------------------
-- Each module receives the canonical App context in on_start(ctx). Persistent
-- data is in ctx.state, which is the Shell-owned State Store namespace.

-- Builtin app bodies live in apps/{chat,settings,keypad}.lua; wired in
-- via require() wrappers at register() below.


-- Pomodoro, carried as Lua source rather than a function on purpose: it is the
-- same shape the voice-UI model already generates, so the "lua" backend gets
-- walked on every boot instead of lying untested until an AI first writes to
-- it. Swapping this string for a generated one is the whole integration.
--
-- The State Store namespace is injected by the launcher and is the same data
-- the home ring paints from — start/pause here and the widget tracks the
-- wall-clock deadline even while this screen is closed.
local POMODORO_SRC = require("apps.pomodoro")

-- App Center catalog: a store stub (lib/store.lua). A fixed list of installable
-- apps; swap the module for a store-endpoint fetch without touching the install
-- pipeline. See store.lua.
local APP_CATALOG = require("store")

-- App registry --------------------------------------------------------------

local apps = {}
local apps_by_id = {}

local function register(app)
    if not app.id or apps_by_id[app.id] then
        error("app manager: duplicate or missing app_id", 2)
    end
    app.kind = app.kind or "ui"
    app.state_defaults = app.state_defaults or {}
    local state = state_store.namespace(app.id)
    for key, value in pairs(app.state_defaults) do
        if state:get(key) == nil then
            state:set(key, value)
        end
    end
    apps[#apps + 1] = app
    apps_by_id[app.id] = app
    return app
end

local function find_app(id)
    return apps_by_id[id]
end

local function app_state(app)
    return state_store.namespace(app.id)
end

-- Forward decls: peek builders / go_home call these before their definitions.
local paint_home
local paint_ring
local paint_peek

-- The Peek is Shell-owned even while an App is open. Keep its handles in this
-- module rather than in the active App so a Hero transition never transfers
-- ownership of shared home state to an App runtime.
local peek_ui = { app_id = nil, hooks = nil }

-- Pomodoro helpers — home ring, peek controls, and the app body share state.
local function pomo_mmss(s)
    return string.format("%02d:%02d", s // 60, s % 60)
end

local function pomo_sync(st, now)
    now = now or os.time()
    st.session = st.session or (25 * 60)
    if st.remaining == nil then
        st.remaining = st.session
    end
    if st.deadline then
        st.remaining = math.max(0, st.deadline - now)
        if st.remaining == 0 then
            st.deadline = nil
        end
    end
    return st.remaining
end

local function pomo_toggle(st)
    pomo_sync(st)
    if st.deadline then
        st.deadline = nil
    elseif (st.remaining or 0) == 0 then
        st.remaining = st.session
    else
        st.deadline = os.time() + st.remaining
    end
    return pomo_sync(st)
end

local function pomo_control(st)
    pomo_sync(st)
    if st.deadline then
        return "Pause", aiodi.colors.button
    elseif (st.remaining or 0) == 0 then
        return "Reset", aiodi.colors.green
    end
    return "Start", aiodi.colors.green
end

-- What a "lua" app may reach on the `lvgl` module: widgets and constants.
--
-- An allowlist, not a denylist. The module also carries `init`/`deinit` (which
-- race the adapter worker's recursive LVGL lock and freeze the panel),
-- `indev_unregister` (deletes the touch device -- the screen keeps redrawing
-- and nothing can ever be tapped again, a trap that needs a reboot), `run` and
-- `demo` (both seize the loop), and `create_screen` (the launcher owns the
-- frame). Naming what is safe is the only form that stays safe as the binding
-- grows a new entry point.
local APP_LVGL_API = {
    object = true, container = true, label = true, button = true, bar = true,
    slider = true, image = true, line = true, arc = true, spinner = true,
    scale = true, checkbox = true, switch = true, dropdown = true,
    roller = true, keyboard = true, list = true, textarea = true,
    table = true, buttonmatrix = true, calendar = true, canvas = true,
    chart = true, imagebutton = true, led = true, menu = true, msgbox = true,
    spangroup = true, spinbox = true, tabview = true, tileview = true,
    window = true, SYMBOL = true, font_load = true,
}

-- The design system is a module with Shell-only entry points as well as App
-- builders. Give an App a fresh, data-copied facade: `aiodi.app`, `screen`,
-- `app_frame`, `load_anim`, and `transition` stay private to the Shell, while
-- mutable token tables cannot be used to alter the resident Shell globally.
local APP_AIODI_FUNCTIONS = {
    font = true, font_bold = true, scale = true, px = true,
    grid_metrics = true, card = true, meter = true, statusbar = true,
    clock = true, title = true, caption = true, app_icon = true,
    tile = true, list_row = true, empty = true, loading = true,
    error = true, grid = true, svg_icon = true, button = true,
}

local APP_AIODI_DATA = {
    VERSION = true, colors = true, space = true, radius = true,
    text = true, chrome = true, ref = true,
}

local function copy_value(value)
    if type(value) ~= "table" then
        return value
    end
    local copy = {}
    for key, nested in pairs(value) do
        copy[key] = copy_value(nested)
    end
    return copy
end

-- Sandbox for Lua Apps: the design system plus the widget API above and the
-- immutable App context. The context's State Store namespace is the only
-- shared-data seam; raw launcher tables are never exposed.
local function app_env(ctx)
    local safe_lvgl = {}
    for k in pairs(APP_LVGL_API) do
        safe_lvgl[k] = copy_value(lvgl[k])
    end
    local safe_aiodi = {}
    for k in pairs(APP_AIODI_FUNCTIONS) do
        safe_aiodi[k] = aiodi[k]
    end
    for k in pairs(APP_AIODI_DATA) do
        safe_aiodi[k] = copy_value(aiodi[k])
    end
    local env = {
        aiodi = safe_aiodi, lvgl = safe_lvgl, ICONS = copy_value(_G.ICONS),
        WIDTH = _G.WIDTH, HEIGHT = _G.HEIGHT,
        math = math, string = string, table = table,
        os = { date = os.date, time = os.time, clock = os.clock },
        ipairs = ipairs, pairs = pairs, select = select, type = type,
        tonumber = tonumber, tostring = tostring, error = error, pcall = pcall,
    }
    -- Our own require, or an app could pull the unfiltered lvgl straight back.
    env.require = function(name)
        if name == "lvgl" then
            return safe_lvgl
        elseif name == "aiodi" then
            return aiodi
        elseif name == "almanac" then
            return require("almanac")
        end
        error("app sandbox: require('" .. tostring(name) .. "') is not allowed", 0)
    end
    return env
end

local function run_lua_app(app, ctx)
    if type(app.src) == "table" then
        return app.src
    end
    if type(app.src) ~= "string" then
        error("App entry source must be Lua text", 0)
    end
    local chunk, err = load(app.src, "@" .. app.id, "t", app_env(ctx))
    if not chunk then
        error("compile: " .. tostring(err), 0)
    end
    local module = chunk()
    if type(module) ~= "table" or type(module.on_start) ~= "function" then
        error("App entry must return a table with on_start(ctx)", 0)
    end
    return module
end

local function make_app_context(app, content)
    return {
        app_id = app.id,
        root = content,
        state = app_state(app),
        width = _G.WIDTH,
        height = _G.HEIGHT,
    }
end

local function hero_tick_ms()
    local ok, value = pcall(function() return lvgl.tick_ms() end)
    if ok and type(value) == "number" then
        return value
    end
    return nil
end

local function copy_source_rect(source)
    if not source or type(source.get_coords) ~= "function" then
        return nil
    end
    local ok, x, y, w, h = pcall(function()
        return source:get_coords()
    end)
    if not ok or type(x) ~= "number" or type(y) ~= "number"
        or type(w) ~= "number" or type(h) ~= "number"
        or w <= 0 or h <= 0 then
        return nil
    end
    return {
        x = x, y = y, w = w, h = h,
        radius = aiodi.grid_metrics().radius,
    }
end

local function lerp(a, b, progress)
    return math.floor(a + (b - a) * progress + 0.5)
end

local function hero_geometry(rect, progress)
    local W = _G.WIDTH or 480
    local H = _G.HEIGHT or 800
    return lerp(rect.x, 0, progress), lerp(rect.y, 0, progress),
        lerp(rect.w, W, progress), lerp(rect.h, H, progress),
        lerp(rect.radius, 0, progress)
end

-- The Hero panel immediately takes over the source rectangle. The live home
-- widget stays in its normal layout beneath this opaque panel; only the panel
-- geometry changes during both directions of the transition.
local function create_hero_cover(parent, rect, progress)
    local x, y, w, h, radius = hero_geometry(rect, progress or 0)
    local cover = lvgl.container(parent, {
        x = x, y = y, w = w, h = h,
        bg_color = aiodi.colors.surface, bg_opa = 255, opa = 255,
        radius = radius, border_width = 0, pad = 0 })
    cover:set_scroll(NO_SCROLL)
    cover:set_clickable(true)
    hero.cover = cover
    return cover
end

local function prepare_hero_open(source, source_rect)
    hero.source = source
    hero.source_rect = source_rect
end

local function remove_hero_cover()
    if hero.cover then
        pcall(function() hero.cover:delete() end)
        hero.cover = nil
    end
end

local function prepare_hero_scene(rect, opening)
    local progress = opening and 0 or 1
    local ok, cover_or_error = pcall(create_hero_cover, home, rect, progress)
    if not ok or not cover_or_error then
        return nil, ok and "unable to create the Hero cover" or tostring(cover_or_error)
    end
    -- On entry this opaque panel replaces the tapped widget before the first
    -- geometry tick. On Back it first hides the full App, then contracts to
    -- the same stationary widget beneath it.
    return true
end

local function apply_hero(geometry_progress)
    local cover = hero.cover
    local rect = hero.source_rect
    if not cover or not rect then
        return false
    end
    local x, y, w, h, radius = hero_geometry(rect, geometry_progress)
    -- Both directions mutate only the same opaque surface geometry. The live
    -- source stays fixed on entry and stays in its home layout on return.
    cover:set_frame(x, y, w, h, radius)
    return true
end

local function reset_hero()
    transition_phase = "idle"
    hero.cover = nil
    hero.source = nil
    hero.source_rect = nil
    hero.elapsed_ms = 0
    hero.duration_ms = 0
    hero.opening = false
    hero.last_tick_ms = nil
end

local function begin_hero(runtime, source_rect, opening)
    hero.source_rect = source_rect
    hero.elapsed_ms = 0
    hero.duration_ms = math.max(1, opening and aiodi.transition.hero_open
                                     or aiodi.transition.hero_close)
    hero.opening = opening
    hero.last_tick_ms = hero_tick_ms()
    if opening then
        transition_phase = "opening"
    else
        transition_phase = "closing"
    end
    -- Opening and Back use the same geometry at opposite normalized times.
    return apply_hero(opening and 0 or 1)
end

local function stop_runtime(runtime)
    if not runtime or runtime.stopped then
        return
    end
    runtime.stopped = true
    local module = runtime.module
    if module and type(module.on_stop) == "function" then
        pcall(module.on_stop, runtime.context)
    end
end

local function build_app_runtime(app, parent, initially_hidden)
    local screen, root, content
    local frame_opa = initially_hidden and 0 or 255
    if parent then
        root, content = aiodi.app_frame(parent, {
            title = app.name,
            on_back = function() M.go_home() end,
            opa = frame_opa,
        })
    else
        screen, content = aiodi.app({
            title = app.name,
            on_back = function() M.go_home() end,
        })
        root = screen
    end
    local ctx = make_app_context(app, content)
    local ok, module_or_error = pcall(function()
        local module
        if app.kind == "lua" then
            module = run_lua_app(app, ctx)
        else
            module = app.module
        end
        if type(module) ~= "table" or type(module.on_start) ~= "function" then
            error("builtin App is missing on_start(ctx)", 0)
        end
        module.on_start(ctx)
        return module
    end)
    if not ok then
        pcall(function()
            if screen then
                screen:delete()
            else
                root:delete()
            end
        end)
        return nil, tostring(module_or_error)
    end
    return {
        root = root,
        screen = screen,
        context = ctx,
        module = module_or_error,
        hero = parent ~= nil,
        stopped = false,
    }
end

local function open(app, source)
    if not app or app_manager.phase ~= "shell" or transition_phase ~= "idle" then
        return false
    end
    local source_rect = copy_source_rect(source)
    app_manager.phase = "starting"
    if source_rect then
        prepare_hero_open(source, source_rect)
    end
    local runtime, err = build_app_runtime(app, source_rect and home or nil, source_rect ~= nil)
    if not runtime then
        app_manager.phase = "error"
        app_manager.error = err
        app_manager.phase = "shell"
        reset_hero()
        return false
    end
    if source_rect then
        local ready, hero_error = prepare_hero_scene(source_rect, true)
        if not ready then
            stop_runtime(runtime)
            pcall(function() runtime.root:delete() end)
            app_manager.error = hero_error
            app_manager.phase = "shell"
            reset_hero()
            return false
        end
    end
    app_manager.active_id = app.id
    app_manager.runtime = runtime
    peek.app_id = app.id
    app_manager.error = nil
    if source_rect then
        -- Home tiles and Peek use the fast Material-style 2D Hero path. The App Center
        -- has no source widget, so it intentionally stays on the legacy
        -- directional screen transition below. The opaque geometric panel
        -- takes over the source rectangle while the App frame stays hidden.
        app_manager.phase = "opening"
        if not begin_hero(runtime, source_rect, true) then
            remove_hero_cover()
            stop_runtime(runtime)
            pcall(function() runtime.root:delete() end)
            app_manager.phase = "shell"
            reset_hero()
            return false
        end
    else
        aiodi.load_anim(runtime.screen, "move_left", aiodi.transition.app_open)
        app_manager.phase = "running"
        if type(runtime.module.on_tick) == "function" then
            pcall(runtime.module.on_tick, runtime.context)
        end
    end
    return true
end

-- Bottom peek follows the last opened app. Each app may supply
-- `build_peek(parent, app)` returning optional `{ on_tick = fn }` for live
-- controls (pomodoro: countdown + Start/Pause). Default is icon + title;
-- tap opens the fullscreen app. Nested control buttons must NOT sit inside
-- a parent button — the card is a plain container (peek, not a capsule dock).
--
-- In-card margin is `g.peek_pad` (from aiodi.ref.peek.pad). Controls use a
-- fixed ctrl height — they must not stretch to eat that margin.
local function peek_inner_h(g)
    return math.max(aiodi.px(32), g.peek_h - 2 * g.peek_pad)
end

-- Control row height: leave peek_pad as visible empty margin around chrome.
local function peek_ctrl_h(g)
    return math.min(peek_inner_h(g), aiodi.px(44))
end

-- Peek mark: same SVG language as home tiles. Never use fonts.bar_time for
-- icons — that face is digits-only and renders tofu for FA glyphs.
local function peek_app_mark(parent, app, size)
    if app.svg then
        local img = aiodi.svg_icon(parent, { name = app.svg, size = size })
        if img then
            return img
        end
    end
    return aiodi.title(parent, { text = app.icon })
end

local function default_build_peek(parent, app)
    local g = aiodi.grid_metrics()
    local btn_h = peek_ctrl_h(g)
    local open_btn = lvgl.button(parent, {
        flex_grow = 1, h = btn_h,
        bg_opa = 0, border_width = 0, pad = 0, pad_column = aiodi.space.sm,
        shadow_width = 0 })
    open_btn:set_scroll(NO_SCROLL)
    open_btn:set_flex({
        flow = "row", main = "start", cross = "center", track = "center" })
    peek_app_mark(open_btn, app, math.min(btn_h, aiodi.px(28)))
    aiodi.title(open_btn, { text = app.name, font = fonts.body })
    open_btn:on("clicked", function()
        open(app, hud.peek_head)
    end)
end

local function build_peek_pomodoro(parent, app)
    local g = aiodi.grid_metrics()
    local st = app_state(app)
    local btn_h = peek_ctrl_h(g)
    local ctrl_w = aiodi.px(112)

    -- Live countdown in the peeked head; tap opens fullscreen.
    local open_btn = lvgl.button(parent, {
        flex_grow = 1, h = btn_h,
        bg_opa = 0, border_width = 0, pad = 0, shadow_width = 0 })
    open_btn:set_scroll(NO_SCROLL)
    open_btn:set_flex({
        flow = "row", main = "start", cross = "center", track = "center" })
    local face = aiodi.clock(open_btn, {
        text = pomo_mmss(pomo_sync(st)),
        font = fonts.bar_time or fonts.body })
    open_btn:on("clicked", function()
        open(app, hud.peek_head)
    end)

    local label, accent = pomo_control(st)
    local btn = aiodi.button(parent, {
        text = label, accent = accent, w = ctrl_w, h = btn_h })
    btn:on("clicked", function()
        pomo_toggle(st)
        local t, c = pomo_control(st)
        btn:set_text(t)
        btn:set_style({ bg_color = c })
        face:set_text(pomo_mmss(pomo_sync(st)))
        if not app_manager.active_id then
            paint_ring(os.time())
        end
    end)

    return {
        on_tick = function()
            local n = pomo_sync(st)
            face:set_text(pomo_mmss(n))
            local t, c = pomo_control(st)
            btn:set_text(t)
            btn:set_style({ bg_color = c })
        end,
    }
end

-- Isomorphic Live Morph Peeks ---------------------------------------------
-- Rather than statically showing an icon + text, each app morphs its essential
-- living state into the compact bottom peek drawer.
local function make_peek_base(parent, app)
    local g = aiodi.grid_metrics()
    local btn_h = peek_ctrl_h(g)
    local open_btn = lvgl.button(parent, {
        flex_grow = 1, h = btn_h, bg_opa = 0, border_width = 0, pad = 0,
        pad_column = aiodi.space.sm, shadow_width = 0 })
    open_btn:set_scroll(NO_SCROLL)
    open_btn:set_flex({ flow = "row", main = "start", cross = "center", track = "center" })
    peek_app_mark(open_btn, app, math.min(btn_h, aiodi.px(28)))
    local title_lbl = aiodi.title(open_btn, { text = app.name, font = fonts.body })
    open_btn:on("clicked", function()
        open(app, hud.peek_head)
    end)
    return btn_h, title_lbl
end

local function build_peek_breath(parent, app)
    make_peek_base(parent, app)
    local phase_lbl = aiodi.caption(parent, { text = "Inhale...", font = fonts.body })
    return {
        on_tick = function()
            local sec = math.floor(os.clock()) % 12
            if sec < 4 then phase_lbl:set_text("Inhale 4s")
            elseif sec < 8 then phase_lbl:set_text("Hold 4s")
            else phase_lbl:set_text("Exhale 4s") end
        end
    }
end

local function build_peek_dice(parent, app)
    local btn_h, title_lbl = make_peek_base(parent, app)
    local roll_btn = aiodi.button(parent, { text = "Roll", accent = aiodi.colors.red, w = aiodi.px(100), h = btn_h })
    roll_btn:on("clicked", function()
        local val = math.random(1, 6)
        title_lbl:set_text("Dice: " .. val)
    end)
end

local function build_peek_settings(parent, app)
    make_peek_base(parent, app)
    local val = (type(_G.kv_get) == "function" and _G.kv_get("wifi")) or 0
    local status_lbl = aiodi.caption(parent, { text = val ~= 0 and "Wi-Fi: ON" or "Wi-Fi: OFF" })
    return {
        on_tick = function()
            local v = (type(_G.kv_get) == "function" and _G.kv_get("wifi")) or 0
            status_lbl:set_text(v ~= 0 and "Wi-Fi: ON" or "Wi-Fi: OFF")
        end
    }
end

local function paint_peek()
    local app = find_app(peek.app_id)
    if not app or not hud.peek_head then
        return
    end
    if peek_ui.app_id ~= app.id then
        -- Rebuild body for the new app. Delete+recreate: the binding has no
        -- "clear children", and leftover controls from the previous app must
        -- not linger.
        local g = aiodi.grid_metrics()
        local parent = hud.peek_head
        local body_h = peek_inner_h(g)
        if hud.peek_body then
            hud.peek_body:delete()
            hud.peek_body = nil
        end
        hud.peek_body = lvgl.container(parent, {
            flex_grow = 1, h = body_h,
            bg_opa = 0, border_width = 0, pad = 0, pad_column = g.peek_pad })
        hud.peek_body:set_scroll(NO_SCROLL)
        hud.peek_body:set_flex({
            flow = "row", main = "space_between", cross = "center",
            track = "center" })

        peek_ui.app_id = app.id
        local builder = app.build_peek or default_build_peek
        local ok, hooks = pcall(builder, hud.peek_body, app)
        peek_ui.hooks = (ok and type(hooks) == "table") and hooks or nil
        if not ok then
            pcall(function()
                if hud.peek_body then
                    hud.peek_body:delete()
                end
            end)
            hud.peek_body = lvgl.container(parent, {
                flex_grow = 1, h = body_h,
                bg_opa = 0, border_width = 0, pad = 0, pad_column = g.peek_pad })
            hud.peek_body:set_scroll(NO_SCROLL)
            hud.peek_body:set_flex({
                flow = "row", main = "start", cross = "center", track = "center" })
            default_build_peek(hud.peek_body, app)
            peek_ui.hooks = nil
        end
    elseif peek_ui.hooks and peek_ui.hooks.on_tick then
        pcall(peek_ui.hooks.on_tick)
    end
end

local function hero_delta_ms(now)
    local delta = HERO_FALLBACK_TICK_MS
    if now ~= nil and hero.last_tick_ms ~= nil then
        delta = now - hero.last_tick_ms
        if delta < 0 then
            delta = delta + LVGL_TICK_WRAP_MS
        end
        if delta < 1 or delta > HERO_MAX_TICK_DELTA_MS then
            delta = HERO_FALLBACK_TICK_MS
        end
    end
    if now ~= nil then
        hero.last_tick_ms = now
    end
    return delta
end

local function finish_hero_open()
    local runtime = app_manager.runtime
    if runtime and runtime.root then
        -- The cover is already opaque and full-size, so this one-time reveal
        -- cannot expose a partial App frame or add per-frame PPA blending.
        local revealed, reveal_error = pcall(function()
            return runtime.root:set_style({ opa = 255 })
        end)
        if not revealed then
            app_manager.error = tostring(reveal_error)
        end
    end
    -- The full opaque panel is still above the App while it becomes visible,
    -- so deleting the panel cannot reveal a partially constructed frame.
    remove_hero_cover()
    app_manager.phase = "running"
    transition_phase = "idle"
    hero.opening = false
    hero.last_tick_ms = nil
end

local function finish_hero_close()
    -- The App was stopped and removed only after the full cover appeared in
    -- go_home(). Refresh the resident Shell while it is still hidden by the
    -- contracted panel, then expose the original stationary widget in one step.
    app_manager.active_id = nil
    app_manager.runtime = nil
    app_manager.phase = "shell"
    peek_ui.app_id = nil
    if paint_home then
        pcall(paint_home)
    end
    remove_hero_cover()
    reset_hero()
end

local function tick_hero()
    if transition_phase == "idle" then
        return false
    end

    local now = hero_tick_ms()
    local delta = hero_delta_ms(now)

    hero.elapsed_ms = math.min(hero.duration_ms, hero.elapsed_ms + delta)
    local raw = hero.elapsed_ms / hero.duration_ms
    -- Use the same fast-out curve in reverse so Back responds on its first
    -- frame instead of lingering at full-screen during an ease-in-out lead-in.
    local geometry_progress = hero.opening and aiodi.ease_out(raw)
        or aiodi.ease_out(1 - raw)
    apply_hero(geometry_progress)
    if raw < 1 then
        return true
    end

    if hero.opening then
        finish_hero_open()
        return true
    end

    finish_hero_close()
    return true
end

function M.go_home()
    local runtime = app_manager.runtime
    if not runtime or app_manager.phase ~= "running" or transition_phase ~= "idle" then
        return false
    end
    app_manager.phase = "stopping"
    if runtime.hero and hero.source and hero.source_rect then
        -- The cover is made full and opaque before the App goes away. The
        -- source stays in its home layout while the same panel contracts.
        local ready, hero_error = prepare_hero_scene(hero.source_rect, false)
        if not ready then
            app_manager.phase = "running"
            app_manager.error = hero_error
            return false
        end
        app_manager.phase = "closing"
        if not begin_hero(runtime, hero.source_rect, false) then
            remove_hero_cover()
            app_manager.phase = "running"
            app_manager.error = "unable to begin Hero return"
            return false
        end
        stop_runtime(runtime)
        if runtime.root then
            pcall(function() runtime.root:delete() end)
            runtime.root = nil
        end
        return true
    end

    stop_runtime(runtime)
    app_manager.active_id = nil
    app_manager.runtime = nil
    -- App Center has no source rectangle, so its legacy screen transition is
    -- retained as the explicit no-source fallback.
    local shell_screen = home
    aiodi.load_anim(shell_screen, "move_right", aiodi.transition.app_close, 0, true)
    app_manager.phase = "shell"
    -- Force peek rebuild/tick so controls match shared state after Back.
    peek_ui.app_id = nil
    paint_home()
    return true
end

-- Open a registered app by id; false if there is no such app. Public because
-- registering an app and then showing it is the natural pair for the C/AI
-- caller, and because it makes navigation drivable from a test.
function M.open(id)
    return open(find_app(id))
end

-- Register a Lua app at runtime -- the seam an AI-generated app plugs into.
-- `spec.src` must follow the app contract (see launcher.md): it returns an App
-- module with on_start(ctx) and optional lifecycle callbacks. State defaults
-- seed the
-- persistent shared table (home widget + app body). Apps past the fourth are
-- registered but have no home slot yet; the design's page dots and
-- `Homepage / #2` are where they will land.
function M.add_lua_app(spec)
    return register({
        id = spec.id, name = spec.name, icon = spec.icon,
        accent = spec.accent, kind = "lua", src = spec.src,
        state_defaults = spec.state_defaults,
    })
end

-- Cards and their containers never scroll -- these are fixed grids, not
-- lists. LVGL flags every plain container scrollable (lv_button clears the
-- flag, lv_obj does not), so any child that reaches the edge silently turns
-- its container into a scroller with a visible bar. aiodi.tile applies this
-- itself; the raw containers around the tiles (and the splash containers)
-- apply it here.
NO_SCROLL = { dir = "none", scrollbar = "off" }

-- Home ----------------------------------------------------------------------

-- The 2x2 ring: pomodoro session arc + remaining `mm:ss`.
-- Same `state` table the Pomodoro app mutates (start/pause/reset).
--
-- Progress-ring practice + Figma Homepage/#1 ratios:
--   1. Outer diameter ≈ 2/3 of the tile (Figma 138/208) — balanced margin,
--      not edge-to-edge.
--   2. Stroke ≈ 12% of diameter (modern rings; Figma's ~17% reads heavy).
--   3. Label font is derived from the remaining hole (≈ hole/3.4) so "25:00"
--      keeps air to the inner stroke — never collide, never dominate.
--
-- LVGL only takes arc angles at construction and cannot reorder children, so
-- a change repaints both — arc first, label on top.
paint_ring = function(now)
    local pomo = find_app("pomodoro")
    if not pomo then
        return
    end
    local st = app_state(pomo)
    local left = pomo_sync(st, now)
    local session = st.session
    -- Countdown arc: full at session start, drains to empty when done.
    -- Cap at 359° — a full 360° end-angle is a no-op in LVGL's arc.
    local deg = math.max(1, math.min(359,
        math.floor(360 * left / session + 0.5)))
    local label = pomo_mmss(left)
    if painted.ring_deg == deg and painted.ring_label == label
        and painted.ring_d == hud.ring_d then
        return
    end
    painted.ring_deg, painted.ring_label = deg, label

    local g = aiodi.grid_metrics()
    local tile = 2 * g.cell + g.gutter
    local ref_tile = 2 * aiodi.ref.cell + aiodi.ref.gutter
    local d = math.floor(tile * (aiodi.ref.ring.d / ref_tile) + 0.5)
    local arc_w = math.max(1, math.floor(d * 0.12 + 0.5))
    local hole = d - 2 * arc_w
    -- "25:00" ≈ 3em wide + pad → span ~3.4em.
    local font_px = math.max(14, math.min(
        aiodi.px(aiodi.ref.text.ring),
        math.floor(hole / 3.4 + 0.5)))
    painted.ring_d = d

    if hud.ring then
        hud.ring:delete()
    end
    if hud.ring_label then
        hud.ring_label:delete()
    end

    local inset = (tile - d) // 2
    hud.ring_d = d
    hud.ring = lvgl.arc(hud.ring_tile, {
        x = inset, y = inset, w = d, h = d,
        bg_start_angle = 270, bg_end_angle = 270 + deg,
        line_color = aiodi.colors.red,
        arc_width = arc_w,
        interactive = false,
    })
    local ring_font = aiodi.font_bold(font_px, { cache_size = 16 }) or fonts.ring
    hud.ring_label = aiodi.clock(hud.ring_tile, {
        text = label, font = ring_font, align = "center" })
end

-- Simulated Claude Code remaining quotas (percent). Not a live Anthropic
-- pull — a host-side stand-in so Homepage/#2 can iterate the look. Drifts
-- gently through the day so the card feels alive under tick().
local function simulated_claude_quota(now)
    local t = os.date("*t", now)
    local day_frac = (t.hour * 3600 + t.min * 60 + t.sec) / 86400
    -- 5-day window: morning headroom burns toward evening.
    local day5 = math.floor(78 - day_frac * 32 + 0.5)
    -- Weekly window: early-week room, late-week tighter (wday Sun=1).
    local week = math.floor(62 - ((t.wday - 1) / 6) * 28 + 0.5)
    local function clamp(p)
        return math.max(3, math.min(99, p))
    end
    return clamp(day5), clamp(week)
end

-- Keep visible marker edges equally spaced while touch slots remain separate.
-- The active pill is wider than an idle dot, so equal slot centers alone would
-- leave a visibly larger gap after the second dot.
local function layout_page_markers(widths)
    if not hud.page_dots or not hud.page_pager then
        return
    end
    local slot_w = hud.page_hit_w or 1
    local gap = aiodi.px(aiodi.ref.bar.dot_gap)
    local offsets = {}
    local cumulative = 0
    local min_offset = 0
    local max_offset = math.huge
    for i, w in ipairs(widths) do
        offsets[i] = cumulative
        min_offset = math.max(min_offset, -cumulative)
        max_offset = math.min(max_offset, slot_w - w - cumulative)
        if i < #widths then
            cumulative = cumulative + w + gap - slot_w
        end
    end
    if max_offset < min_offset then
        max_offset = min_offset
    end
    local offset = math.floor((min_offset + max_offset) / 2 + 0.5)
    local visual_left = math.huge
    local visual_right = -math.huge
    local dot_y = math.floor((hud.page_bar_h - hud.dot_idle) / 2 + 0.5)
    for i, d in ipairs(hud.page_dots) do
        local x = offsets[i] + offset
        local absolute_x = (i - 1) * slot_w + x
        d:set_pos(x, dot_y)
        d:set_size(widths[i], hud.dot_idle)
        visual_left = math.min(visual_left, absolute_x)
        visual_right = math.max(visual_right, absolute_x + widths[i])
    end
    local visual_center = (visual_left + visual_right) / 2
    local pager_x = math.floor(((_G.WIDTH or 480) / 2) - visual_center + 0.5)
    hud.page_pager:set_pos(pager_x, 0)
end

local function paint_page_progress()
    if not hud.page_dots then
        return
    end
    local x = 0
    if hud.pages and type(hud.pages.get_scroll) == "function" then
        x = select(1, hud.pages:get_scroll())
    end
    local slot = hud.page_slot_w or 1
    local t = x / slot
    local n = math.floor(t + 0.5) + 1
    if n < 1 then
        n = 1
    elseif n > HOME_PAGE_COUNT then
        n = HOME_PAGE_COUNT
    end
    home_page = n

    local idle = hud.dot_idle or aiodi.px(aiodi.ref.bar.dot)
    local active_w = hud.dot_active_w or aiodi.px(aiodi.ref.bar.dot_active)
    local widths = {}
    for i, d in ipairs(hud.page_dots) do
        local dist = math.abs((i - 1) - t)
        if dist > 1 then
            dist = 1
        end
        local w = math.floor(active_w + (idle - active_w) * dist + 0.5)
        widths[i] = math.max(idle, w)
        d:set_style({
            bg_color = (dist < 0.45) and aiodi.colors.primary or aiodi.colors.button,
            radius = aiodi.radius.pill })
    end
    layout_page_markers(widths)
end

local function paint_page_dots(n)
    home_page = n
    if not hud.page_dots then
        return
    end
    -- Discrete settle: jump the progress read to the page's slot origin.
    local idle = hud.dot_idle or aiodi.px(aiodi.ref.bar.dot)
    local active_w = hud.dot_active_w or aiodi.px(aiodi.ref.bar.dot_active)
    local widths = {}
    for i, d in ipairs(hud.page_dots) do
        local on = (i == n)
        widths[i] = on and active_w or idle
        d:set_style({
            bg_color = on and aiodi.colors.primary or aiodi.colors.button,
            radius = aiodi.radius.pill })
    end
    layout_page_markers(widths)
end

-- Map scroller x → 1-based page. Slot = page width + inter-page gutter.
local function page_from_scroll()
    if not hud.pages or type(hud.pages.get_scroll) ~= "function" then
        return home_page
    end
    local x = select(1, hud.pages:get_scroll())
    local slot = (hud.page_slot_w or 1)
    local n = math.floor((x + slot / 2) / slot) + 1
    if n < 1 then
        n = 1
    elseif n > HOME_PAGE_COUNT then
        n = HOME_PAGE_COUNT
    end
    return n
end

local function go_home_page(n, anim)
    if not hud.pages or n < 1 or n > HOME_PAGE_COUNT then
        return
    end
    paint_page_dots(n)
    local slot = hud.page_slot_w or 0
    if type(hud.pages.scroll_to) == "function" then
        hud.pages:scroll_to((n - 1) * slot, 0, anim ~= false)
    end
end

local function on_home_scroll()
    paint_page_progress()
end

local function on_home_scroll_end()
    paint_page_dots(page_from_scroll())
end

-- Simulated & Real AI Provider Quotas --------------------------------------
-- Handles both Ark Coding Plan (Volcano) and Claude Code quota windows.
local function get_ark_quota(now)
    -- Safe KV getter: guarantees non-nil fallback to avoid string concat errors
    local function get(k, d)
        if type(_G.kv_get) == "function" then
            local v = _G.kv_get(k)
            if v ~= nil then return v end
        end
        return d
    end
    return {
        session = get("ark_session", 0),
        weekly  = get("ark_weekly", 100),
        monthly = get("ark_monthly", 50)
    }
end

local function paint_agent_quota(now)
    if not hud.quota_ark_week then
        return
    end
    local ark = get_ark_quota(now)
    local day5, week = simulated_claude_quota(now)
    if painted.quota_day5 == day5 and painted.quota_week == week and painted.quota_ark_w == ark.weekly then
        return
    end
    painted.quota_day5, painted.quota_week = day5, week
    painted.quota_ark_w = ark.weekly

    -- Update Ark meters
    if hud.quota_ark_week.value then hud.quota_ark_week.value:set_text(ark.weekly .. "%") end
    if hud.quota_ark_month.value then hud.quota_ark_month.value:set_text(ark.monthly .. "%") end
    if hud.quota_ark_sess.value then hud.quota_ark_sess.value:set_text(ark.session .. "%") end

    hud.quota_ark_week.fill:set_size(math.max(1, (hud.quota_ark_week.track_w * ark.weekly) // 100), hud.quota_ark_week.bar_h)
    hud.quota_ark_month.fill:set_size(math.max(1, (hud.quota_ark_month.track_w * ark.monthly) // 100), hud.quota_ark_month.bar_h)
    hud.quota_ark_sess.fill:set_size(math.max(1, (hud.quota_ark_sess.track_w * ark.session) // 100), hud.quota_ark_sess.bar_h)

    -- Update Claude meters
    if hud.quota_day5.value then hud.quota_day5.value:set_text(day5 .. "%") end
    if hud.quota_week.value then hud.quota_week.value:set_text(week .. "%") end
    hud.quota_day5.fill:set_size(math.max(1, (hud.quota_day5.track_w * day5) // 100), hud.quota_day5.bar_h)
    hud.quota_week.fill:set_size(math.max(1, (hud.quota_week.track_w * week) // 100), hud.quota_week.bar_h)
end

local app_center = require("app_center")

-- Add one provider's quota meters to a pair of grid rows. The outer tile is
-- fixed by the same 3x4 grid as Homepage/#1; meter geometry is derived from
-- the cell, so content cannot grow an unconstrained card past its page.
local function build_quota_tile(grid, g, row, title, specs)
    local card_pad = math.max(1, g.gutter // 2)
    local meter_gap = math.max(1, g.gutter // 2)
    local meter_h = math.max(1, g.cell // 3 + g.gutter // 4)
    local meter_w = math.max(1, g.w - 2 * card_pad - 2 * g.stroke)
    local card = aiodi.tile(grid, {
        col = 1, row = row, col_span = 3, row_span = 2,
        pad = card_pad, pad_row = meter_gap,
        bg_color = aiodi.colors.surface,
        flex = { flow = "column", main = "space_between", cross = "start", track = "center" },
    })
    aiodi.caption(card, { text = spaced(title), font = fonts.body })
    for _, spec in ipairs(specs) do
        local meter = aiodi.meter(card, {
            w = meter_w, h = meter_h, font = fonts.label,
            radius = g.radius, chrome = "space_between", pad_x = meter_gap,
            label = spec.label, value = spec.value, pct = spec.pct,
            fill = spec.fill,
        })
        hud[spec.key] = meter
    end
    return card
end

-- Homepage/#2: AI Compute & Quota Hub (Volcano Ark Coding Plan + Claude Code).
-- Both provider groups are explicit 3-column x 2-row AIODI tiles, matching
-- Homepage/#1's cell/gutter geometry and leaving no free-form overflow path.
local function build_agent_page(parent, g)
    local now = os.time()
    local ark = get_ark_quota(now)
    local day5, week = simulated_claude_quota(now)
    local grid = aiodi.grid(parent, g)

    build_quota_tile(grid, g, 1, "ARK CODING PLAN", {
        { key = "quota_ark_week", label = "1-Week", value = ark.weekly .. "%",
            pct = ark.weekly, fill = aiodi.colors.red },
        { key = "quota_ark_month", label = "1-Month", value = ark.monthly .. "%",
            pct = ark.monthly, fill = aiodi.colors.blue },
        { key = "quota_ark_sess", label = "Session", value = ark.session .. "%",
            pct = ark.session, fill = aiodi.colors.green },
    })
    build_quota_tile(grid, g, 3, "CLAUDE CODE", {
        { key = "quota_day5", label = "5-day", value = day5 .. "%",
            pct = day5, fill = aiodi.colors.blue },
        { key = "quota_week", label = "Week", value = week .. "%",
            pct = week, fill = aiodi.colors.green },
    })

    painted.quota_day5, painted.quota_week = day5, week
    painted.quota_ark_w = ark.weekly
end

-- Top status bar: glyphs, page indicator, clock. Was the bottom bar; now sits
-- above the grid. Indicators are drawn as objects — a glyph's size is locked
-- to the default font.
local function build_status_bar(scr, g)
    local dot = aiodi.px(aiodi.ref.bar.dot)
    local bar = lvgl.container(scr, {
        x = 0, y = 0, w = _G.WIDTH, h = g.status_h,
        bg_opa = 0, border_width = 0, pad = 0 })
    bar:set_scroll(NO_SCROLL)

    local icons = lvgl.container(bar, {
        x = aiodi.px(aiodi.ref.bar.icon_x), y = 0,
        w = aiodi.px(120), h = g.status_h,
        bg_opa = 0, border_width = 0, pad = 0,
        pad_column = aiodi.px(aiodi.ref.bar.icon_gap) })
    icons:set_scroll(NO_SCROLL)
    icons:set_flex({ flow = "row", main = "start", cross = "center", track = "center" })
    aiodi.title(icons, { text = ICONS.wifi })
    aiodi.title(icons, { text = ICONS.bluetooth })
    aiodi.title(icons, { text = ICONS.charge })
    -- Red dot = microphone indicator (spec §7.3). Always-on here = mic armed;
    -- wiring it to the voice-UI task's on/off state is a follow-up.
    lvgl.container(icons, {
        w = dot, h = dot, bg_color = aiodi.colors.red,
        radius = aiodi.radius.pill, border_width = 0, pad = 0 })

    -- Page dots: count = pages; active = wide pill; width lerps while dragging.
    -- Marker edges are laid out independently from the invisible touch slots.
    hud.dot_idle = dot
    hud.dot_active_w = aiodi.px(aiodi.ref.bar.dot_active)
    local hit_w = math.max(aiodi.px(aiodi.ref.bar.dot_hit), hud.dot_active_w)
    local pager_w = HOME_PAGE_COUNT * hit_w
    local pager = lvgl.container(bar, {
        x = ((_G.WIDTH or 480) - pager_w) // 2,
        y = 0, w = pager_w, h = g.status_h,
        bg_opa = 0, border_width = 0, pad = 0 })
    pager:set_scroll(NO_SCROLL)
    hud.page_pager = pager
    hud.page_pager_w = pager_w
    hud.page_hit_w = hit_w
    hud.page_bar_h = g.status_h
    hud.page_dots = {}
    for i = 1, HOME_PAGE_COUNT do
        local hit = lvgl.button(pager, {
            x = (i - 1) * hit_w, y = 0,
            w = hit_w, h = g.status_h,
            bg_opa = 0, border_width = 0, pad = 0, shadow_width = 0 })
        hit:set_scroll(NO_SCROLL)
        local on = (i == 1)
        local d = lvgl.container(hit, {
            x = 0, y = math.floor((g.status_h - dot) / 2 + 0.5),
            w = on and hud.dot_active_w or dot, h = dot,
            bg_color = on and aiodi.colors.primary or aiodi.colors.button,
            radius = aiodi.radius.pill,
            border_width = 0, pad = 0 })
        hud.page_dots[i] = d
        hit:on("clicked", function() go_home_page(i) end)
    end
    layout_page_markers({ hud.dot_active_w, dot, dot })

    hud.bar_clock = aiodi.title(bar, {
        text = "", font = fonts.bar_time, align = "right_mid",
        x = -aiodi.px(aiodi.ref.bar.pad_r), y = 0 })
end

-- Bottom fullscreen-app peek: a near-full-height card clipped to the leftover
-- strip under the grid, so only the top peeks — one app at a time. Live
-- chrome (`build_peek`) sits in the visible head; the rest of the card is
-- below the fold (peek, not a capsule dock).
local function build_peek(scr, g)
    local W = _G.WIDTH or 480
    local H = _G.HEIGHT or 800
    local inset = g.gutter
    local strip = lvgl.container(scr, {
        x = 0, y = g.peek_y, w = W, h = g.peek_h,
        bg_opa = 0, border_width = 0, pad = 0, radius = 0 })
    strip:set_scroll(NO_SCROLL)

    -- Card fills under the status bar — mostly below the fold. The strip
    -- clips it, so home reads as a fullscreen app half-peeking up.
    local card_h = H - g.status_h
    local card = lvgl.container(strip, {
        x = inset, y = 0, w = W - 2 * inset, h = card_h,
        bg_color = aiodi.colors.surface,
        radius = g.radius,
        border_width = g.stroke,
        border_color = aiodi.colors.stroke,
        pad = 0 })
    card:set_scroll(NO_SCROLL)
    hud.peek_card = card

    -- Visible head: peek_pad on every side so chrome sits inside the fold with
    -- real margin (not flush). Controls are shorter than the inner height.
    local head = lvgl.container(card, {
        x = 0, y = 0, w = W - 2 * inset, h = g.peek_h,
        bg_opa = 0, border_width = 0, pad = g.peek_pad,
        pad_column = g.peek_pad })
    head:set_scroll(NO_SCROLL)
    head:set_flex({
        flow = "row", main = "start", cross = "center", track = "center" })
    hud.peek_head = head

    -- Body is rebuilt by paint_peek when the focused app changes.
    -- No leading accent stripe: PRODUCT anti-references ban side-stripe accents;
    -- app identity comes from the SVG mark + title in the peek body.
    hud.peek_body = nil
    peek_ui.app_id = nil
    paint_peek()
end

local function build_home_grid(parent, g, now)
    local centre = { flow = "column", main = "center", cross = "center", track = "center" }
    local grid = aiodi.grid(parent, g)

    -- c1 r1 -- date tile, opens almanac app on tap.
    local date = aiodi.tile(grid, {
        col = 1, row = 1, bg_color = aiodi.colors.primary, flex = centre,
        on_click = function()
            open(apps[5], date)
        end })
    hud.month = aiodi.title(date, {
        text = "", text_color = aiodi.colors.red, font = fonts.spe })
    hud.day = aiodi.title(date, {
        text = "", text_color = aiodi.colors.primary, font = fonts.day })

    -- c2-3 r1 -- clock, on pure black rather than surface.
    local clock = aiodi.tile(grid, {
        col = 2, row = 1, col_span = 2, bg_color = aiodi.colors.bg, flex = centre })
    hud.clock = aiodi.clock(clock, { text = "", font = fonts.clock })

    -- c2-3 r2-3 -- the ring, and the Pomodoro's launch surface.
    hud.ring_tile = aiodi.tile(grid, {
        col = 2, row = 2, col_span = 2, row_span = 2,
        on_click = function()
            open(apps[4], hud.ring_tile)
        end })
    paint_ring(now)

    -- c1 r2 / c1 r3 / c3 r4 -- the three square app tiles. The last wears the
    -- design's focus ring; with touch-only input nothing else ever will.
    -- Icons: SVG Tiny at ~56% of the cell — optical margin inside the tile
    -- reads cleaner than a 70% fill. Fall back to FontAwesome if SVG/io fails.
    local icon_px = math.floor(g.cell * 0.56)
    for _, s in ipairs({
        { col = 1, row = 2, app = apps[1] },
        { col = 1, row = 3, app = apps[2] },
        { col = 3, row = 4, app = apps[3], focus = true },
    }) do
        local t
        t = aiodi.tile(grid, {
            col = s.col, row = s.row,
            bg_color = s.app.accent or aiodi.colors.surface,
            border_color = s.focus and aiodi.colors.stroke_focus or aiodi.colors.stroke,
            flex = centre,
            on_click = function()
                open(s.app, t)
            end })
        local img = s.app.svg and aiodi.svg_icon(t, {
            name = s.app.svg, size = icon_px })
        if not img then
            aiodi.title(t, { text = s.app.icon })
        end
    end

    -- c1-2 r4 -- year progress. lvgl.bar's indicator is theme-coloured and
    -- unreachable from set_style (part 0 only), so the tile is the track and
    -- the fill is a plain child clipped to the tile's corners -- which is why
    -- the tile sets clip_corner: the fill's trailing edge has to stay square,
    -- as in the design, while its leading edge takes the tile's radius.
    -- Children sit in the tile's CONTENT box, inside the border -- size them to
    -- the outer box and they overflow it, which both mismeasures the fill and
    -- (before tiles stopped scrolling) hung a scrollbar off the card.
    local inner_w = 2 * g.cell + g.gutter - 2 * g.stroke
    local inner_h = g.cell - 2 * g.stroke
    local pct = math.floor(year_progress(now) * 100 + 0.5)
    local yr = aiodi.tile(grid, {
        col = 1, row = 4, col_span = 2,
        bg_color = aiodi.colors.surface, clip_corner = 1 })
    -- Meter lives in the tile content box (radius 0: tile already clips).
    aiodi.meter(yr, {
        w = inner_w, h = inner_h, pct = pct,
        fill = aiodi.colors.green,
        label = "Year", value = pct .. "%",
        font = fonts.label, radius = 0,
        chrome = "center", pad_x = aiodi.px(12) })
end

local function build_home()
    local g = aiodi.grid_metrics()
    local now = os.time()
    local scr = aiodi.screen()
    -- Inter-page gutter matches tile gutters so the swipe reads as one grid.
    local page_gap = g.gutter
    hud.page_slot_w = g.w + page_gap

    -- Horizontal pager: page | gap | page. Momentum + elastic overscroll so a
    -- flick coasts and snaps like a physical page. Status bar + peek stay fixed.
    local pages = lvgl.container(scr, {
        x = g.x, y = g.y, w = g.w, h = g.h,
        bg_opa = 0, border_width = 0, pad = 0,
        pad_column = page_gap })
    pages:set_scroll({
        dir = "hor", scrollbar = "off", snap_x = "start",
        elastic = true, momentum = true })
    pages:set_flex({
        flow = "row", main = "start", cross = "start", track = "center" })
    hud.pages = pages
    hud.page_tiles = {}

    for i = 1, HOME_PAGE_COUNT do
        local slot = lvgl.container(pages, {
            w = g.w, h = g.h,
            bg_opa = 0, border_width = 0, pad = 0 })
        slot:set_scroll(NO_SCROLL)
        hud.page_tiles[i] = slot
    end
    build_home_grid(hud.page_tiles[1], g, now)
    build_agent_page(hud.page_tiles[2], g)
    app_center.build_page(hud.page_tiles[3], g, {
        find_app = find_app,
        add_lua_app = M.add_lua_app,
        open = M.open,
        spaced = spaced,
    })
    pages:on("scroll", on_home_scroll)
    pages:on("scroll_end", on_home_scroll_end)

    build_status_bar(scr, g)
    build_peek(scr, g)

    -- Host sim can land on #2 for screenshots: ODK_SIM_HOME_PAGE=2.
    local start = 1
    if os.getenv then
        start = tonumber(os.getenv("ODK_SIM_HOME_PAGE")) or 1
    end
    if start < 1 or start > HOME_PAGE_COUNT then
        start = 1
    end
    go_home_page(start, false)
    return scr
end

-- Repaint the live home values. Cheap when nothing changed.
paint_home = function()
    local now = os.time()
    local hhmm = os.date("%H:%M", now)
    if painted.clock ~= hhmm then
        painted.clock = hhmm
        hud.clock:set_text(hhmm)
        hud.bar_clock:set_text(hhmm)
    end
    -- 更新日期和農曆（只在天變時重算）
    local day = os.date("%d", now)
    if painted.day ~= day then
        painted.day = day
        hud.day:set_text(day)
        hud.month:set_text(spaced(os.date("%b", now):upper()))
    end
    local today = os.date("%Y%m%d", now)
    if painted.almanac ~= today then
        painted.almanac = today
    end
    paint_ring(now)
    paint_agent_quota(now)
    paint_peek()
end

function M.on_start(ctx)
    -- The Shell Runner initialized LVGL and registered touch before entering
    -- this callback; Shell code never owns those global resources.
    -- The AIODI numerals are drawn bold and every one of them is Latin, so they
    -- take the bold face; anything that might hold CJK stays on Noto. A
    -- digits-only label needs nothing like the default 256-glyph cache.
    -- 清除所有字體快取（module load 時 LVGL 未 init，快取全 nil），讓以下重新載入
    aiodi.clear_font_cache()
    local digits = { cache_size = 16 }
    fonts.spe = aiodi.font_bold(aiodi.px(aiodi.ref.text.spe), digits)
    fonts.day = aiodi.font_bold(aiodi.px(aiodi.ref.text.day), digits)
    fonts.clock = aiodi.font_bold(aiodi.px(aiodi.ref.text.clock), digits)
    fonts.ring = aiodi.font_bold(aiodi.px(aiodi.ref.text.ring), digits)
    fonts.label = aiodi.font_bold(aiodi.px(aiodi.ref.text.label), digits)
    fonts.bar_time = aiodi.font_bold(aiodi.px(aiodi.ref.text.bar_time), digits)
    fonts.body = aiodi.font(aiodi.text.body)
    local cjk_spe = aiodi.px(aiodi.ref.text.spe)
    local cjk_lbl = aiodi.px(aiodi.ref.text.label)
    fonts.lunar = aiodi.font(cjk_spe) or fonts.spe
    fonts.lunar_mid = aiodi.font(cjk_lbl) or fonts.label

    -- Tile fills follow the design's colour rhythm rather than each app's idea
    -- of itself: Homepage/#1 carries exactly one saturated icon tile (blue)
    -- against two dark ones, and keeps green for the year bar and red for the
    -- ring. Registration order IS home slot order.
    register({ id = "chat", name = "Chat", icon = ICONS.envelope, svg = "envelope",
        kind = "builtin", module = builtin_module(require("apps.chat")),
        state_defaults = {} })
    register({ id = "calendar", name = "Calendar", icon = ICONS.bars, svg = "calendar",
        accent = aiodi.colors.blue, kind = "builtin",
        module = builtin_module(require("apps.calendar")), state_defaults = {} })
    register({ id = "settings", name = "Settings", icon = ICONS.settings, svg = "settings",
        accent = aiodi.colors.bg, kind = "builtin",
        module = builtin_module(require("apps.settings")), state_defaults = {} })
    register({ id = "pomodoro", name = "Pomodoro", icon = ICONS.refresh, svg = "refresh",
        accent = aiodi.colors.red, kind = "lua", src = POMODORO_SRC,
        build_peek = build_peek_pomodoro,
        state_defaults = { session = 25 * 60, remaining = 25 * 60 } })
    register({ id = "almanac", name = "黄曆", icon = ICONS.bars, svg = "calendar",
        accent = aiodi.colors.primary, kind = "builtin",
        module = { on_start = function(ctx)
            local app = require("apps.almanac")
            app.on_start(ctx)
        end }, state_defaults = {} })

    home = build_home()
    paint_home()
    -- Boot via the `Homepage / #0 Starting...` splash, not straight to home.
    -- home is built and ready; the splash swaps to it once its animation hold
    -- elapses (tick_splash).
    build_splash()
    splash_state.active = true
    splash_state.ticks = 0
    splash:load()
end

local last_tick = 0

function builtin_module(builder)
    if type(builder) == "table" then
        return builder
    end
    return {
        on_start = function(ctx)
            return builder(ctx.root, ctx.state, fonts)
        end,
    }
end

function M.on_tick(ctx)
    -- The splash animation runs every tick (high frame rate): the chasing dots
    -- need to move well inside a second. Everything else only changes on a
    -- second boundary, so it is gated below to spare the display.
    if splash_state.active then
        pcall(tick_splash)
        return
    end
    if transition_phase ~= "idle" then
        pcall(tick_hero)
        return
    end
    if app_manager.phase == "running" and app_manager.runtime then
        local module = app_manager.runtime.module
        if module and type(module.on_tick) == "function" then
            pcall(module.on_tick, app_manager.runtime.context)
        end
        return
    end
    local now = os.time()
    if now ~= last_tick then
        last_tick = now
        pcall(paint_home)
    end
end

function M.on_stop(ctx)
    local runtime = app_manager.runtime
    stop_runtime(runtime)
    app_manager.active_id = nil
    app_manager.runtime = nil
    app_manager.phase = "shell"
    reset_hero()
    -- The Runner calls lvgl.deinit after this callback. That destroys the
    -- complete active screen tree without deleting the active screen under
    -- LVGL, which would trigger an avoidable active-screen warning.
    splash = nil
    home = nil
end

return M
