--
-- plugins/pomodoro.lua -- Pomodoro Focus Timer Plugin (Multi-size + Peek + Dashboard)
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")
local Plugin = {}

Plugin.manifest = {
    id = "pomodoro",
    name = "Pomodoro",
    icon = "hourglass",
    accent = aiodi.colors.red,
    category = "productivity",
}

Plugin.state_defaults = {
    session = 25 * 60,
    remaining = 25 * 60,
    deadline = nil,
    today_completed = 0,
    running = false,
}

local function pomo_sync(st, now)
    now = now or os.time()
    st.session = st.session or (25 * 60)
    if st.remaining == nil then st.remaining = st.session end
    if st.deadline then
        st.remaining = math.max(0, st.deadline - now)
        if st.remaining == 0 then
            st.deadline = nil
            st.running = false
            st.today_completed = (st.today_completed or 0) + 1
        end
    end
    return st.remaining
end

local function pomo_mmss(s)
    local m = math.floor(s / 60)
    local sec = math.floor(s % 60)
    return string.format("%02d:%02d", m, sec)
end

local function pomo_toggle(st)
    local now = os.time()
    pomo_sync(st, now)
    if st.deadline then
        st.deadline = nil
        st.running = false
    elseif st.remaining > 0 then
        st.deadline = now + st.remaining
        st.running = true
    else
        st.remaining = st.session
        st.deadline = now + st.remaining
        st.running = true
    end
end

local function pomo_control(st)
    if st.deadline then
        return "Pause", aiodi.colors.red
    elseif st.remaining > 0 and st.remaining < st.session then
        return "Resume", aiodi.colors.green
    elseif st.remaining == 0 then
        return "Reset", aiodi.colors.button
    else
        return "Start", aiodi.colors.green
    end
end

local function pomodoro_ring_metrics(spec, g)
    g = g or aiodi.grid_metrics()
    local tile_span = spec.w
    local ref_tile = 2 * aiodi.ref.cell + aiodi.ref.gutter
    local diameter = math.floor(tile_span * (aiodi.ref.ring.d / ref_tile) + 0.5)
    local arc_w = math.max(1, math.floor(tile_span * (aiodi.ref.ring.w / ref_tile) + 0.5))
    local inset = math.max(0, (tile_span - diameter) // 2)
    return {
        diameter = diameter,
        arc_w = arc_w,
        inset = inset,
    }
end

Plugin.widgets = {
    -- 1x1 Widget: Focus icon with countdown
    ["1x1"] = function(parent, spec, ctx)
        local st = ctx.state
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 1, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.red,
            pad = 0,
            flex = { flow = "column", main = "center", cross = "center", track = "center" },
        })

        local rem = pomo_sync(st, os.time())
        local mmss_lbl = aiodi.label(tile, {
            text = pomo_mmss(rem),
            font = aiodi.font_bold(aiodi.px(32)),
            color = aiodi.colors.primary,
        })
        aiodi.label(tile, {
            text = "FOCUS",
            font = aiodi.font_bold(aiodi.px(14)),
            color = aiodi.colors.primary,
        })

        local last_tick_sec = 0

        return {
            root = tile,
            on_tick = function()
                local now = os.time()
                if now == last_tick_sec then return end
                last_tick_sec = now
                local cur_rem = pomo_sync(st, now)
                mmss_lbl:set_text(pomo_mmss(cur_rem))
            end,
        }
    end,

    -- 2x2 Widget: Faithful AIODI Pomodoro Launch Ring (Pure Red Arc on Surface)
    ["2x2"] = function(parent, spec, ctx)
        local st = ctx.state
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 2, row_span = spec.row_span or 2,
            bg_color = aiodi.colors.surface,
            pad = 0,
        })

        local rm = pomodoro_ring_metrics(spec, ctx.grid_metrics)
        local ring_arc = lvgl.arc(tile, {
            x = rm.inset, y = rm.inset,
            w = rm.diameter, h = rm.diameter,
            bg_start_angle = 270, bg_end_angle = 271,
            line_color = aiodi.colors.red,
            arc_width = rm.arc_w,
            interactive = false,
        })

        local last_deg = -1
        local last_tick_sec = 0
        local ctrl_btn
        local function update_ctrl()
            local left = pomo_sync(st, os.time())
            if st.deadline then
                ctrl_btn:set_text("Pause")
                ctrl_btn:set_style({ bg_color = aiodi.colors.button })
            elseif left > 0 and left < (st.session or 25*60) then
                ctrl_btn:set_text("Resume")
                ctrl_btn:set_style({ bg_color = aiodi.colors.green })
            elseif left == 0 then
                ctrl_btn:set_text("Reset")
                ctrl_btn:set_style({ bg_color = aiodi.colors.button })
            else
                ctrl_btn:set_text("Start")
                ctrl_btn:set_style({ bg_color = aiodi.colors.green })
            end
        end
        local function update_arc(now)
            now = now or os.time()
            if now == last_tick_sec then return end
            last_tick_sec = now
            local left = pomo_sync(st, now)
            local session = st.session or (25 * 60)
            local deg = math.max(1, math.min(359, math.floor(360 * left / session + 0.5)))
            if deg ~= last_deg then
                last_deg = deg
                ring_arc:set_bg_angles(270, 270 + deg)
            end
            update_ctrl()
        end

        local btn_h = math.max(28, rm.arc_w + 8)
        ctrl_btn = aiodi.button(tile, {
            text = "Start", accent = aiodi.colors.green,
            w = spec.w - 2 * rm.inset, h = btn_h,
        })
        ctrl_btn:set_pos(rm.inset, spec.h - btn_h - rm.inset)
        update_ctrl()

        ctrl_btn:on("clicked", function()
            pomo_toggle(st)
            update_ctrl()
        end)
        update_arc()

        return {
            root = tile,
            on_tick = function() update_arc() end,
        }
    end,
}

Plugin.dashboard = {
    metric_key = "focus",
    get_value = function(state, now)
        local count = state.today_completed or 99
        return string.format("%d focus", count)
    end,
    icon = 0xF254,
}

return Plugin
