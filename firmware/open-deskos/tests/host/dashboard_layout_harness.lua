local aiodi = require("aiodi")
local layout = require("dashboard_layout")
local lvgl = require("lvgl")

local module = {}

local function fail(message)
    error("Dashboard layout harness: " .. message)
end

local function expect_equal(actual, expected, label)
    if actual ~= expected then
        fail(string.format("%s: %d/%d", label, actual, expected))
    end
end

local function physical_baseline(item_y, label_y, line_height, base_line)
    return item_y + label_y + line_height - base_line
end

local function group_index(group_id)
    for index, group in ipairs(layout.flow_groups) do
        if group.id == group_id then
            return index
        end
    end
    fail("unknown semantic group " .. group_id)
end

local function verify_no_early_breaks(metrics, values, plan, label)
    local fonts = layout.font_metrics(metrics, layout.preferred_text_size)
    for row_index = 1, #plan.rows - 1 do
        local line = plan.rows[row_index]
        local next_line = plan.rows[row_index + 1]
        local next_group = layout.flow_groups[group_index(next_line.group_ids[1])]
        local candidate = {}
        for _, part in ipairs(line.parts) do
            candidate[#candidate + 1] = part
        end
        for _, part in ipairs(layout.resolve_group_parts(next_group, values)) do
            candidate[#candidate + 1] = part
        end
        if layout.line_width(metrics, fonts, candidate) <= metrics.canvas_w then
            fail(string.format("%s line %d broke before semantic group %s could fit", label,
                row_index, next_group.id))
        end
    end
end

local function verify_plan_shape(metrics, values, label, expected)
    local plan = layout.plan(metrics, values)
    local flowed, abbreviated = false, false
    for index, line in ipairs(plan.rows) do
        if line.width > metrics.canvas_w then
            fail(string.format("%s line %d overflows: %d/%d", label, index,
                line.width, metrics.canvas_w))
        end
        expect_equal(line.fonts.size, layout.preferred_text_size,
            string.format("%s line %d changed Dashboard type scale", label, index))
        flowed = flowed or line.mode == "flow"
        abbreviated = abbreviated or line.abbreviated
    end
    if expected.preferred then
        -- Every line was checked above; this flag makes the shared-scale
        -- contract explicit at each fixture call site.
    end
    if expected.flow and not flowed then
        fail(label .. " did not flow semantic groups")
    end
    if expected.abbreviate and not abbreviated then
        fail(label .. " did not abbreviate an unbreakable atom")
    end
    verify_no_early_breaks(metrics, values, plan, label)
    return plan
end

local function render_prose(row, part, fonts)
    local width = fonts.prose_font:measure(part.text)
    local item = lvgl.container(row, {
        w = width, h = fonts.row_h,
        bg_opa = 0, border_width = 0, pad = 0,
    })
    item:set_scroll({ dir = "none", scrollbar = "off" })
    local label = aiodi.caption(item, {
        x = 0, y = fonts.prose_label_y,
        w = width, h = fonts.prose_line_height,
        text = part.text, font = fonts.prose_font,
        text_color = aiodi.colors.secondary, floating = true,
    })
    return item, label
end

local function render_metric(metrics, row, part, fonts)
    local spec = layout.metric_measure(metrics, fonts, part.key, part.text)
    local has_icon = part.icon ~= false
    local item = lvgl.container(row, {
        w = layout.part_width(metrics, fonts, part), h = fonts.row_h,
        bg_opa = 0, border_width = 0, pad = 0,
    })
    item:set_scroll({ dir = "none", scrollbar = "off" })
    local icon = nil
    if has_icon then
        local icon_frame = layout.inline_icon_frame(metrics, fonts, part.key)
        icon = aiodi.icon_label(item, {
            name = part.key, size = metrics.icon_size,
            color = aiodi.colors.primary,
            x = icon_frame.x, y = icon_frame.y,
            w = icon_frame.w, h = icon_frame.h,
            align = "left", floating = true,
        })
        if not icon then
            fail("metric icon was not created for " .. part.key)
        end
    end
    local label = aiodi.title(item, {
        x = has_icon and layout.icon_width(metrics, part.key) + metrics.icon_gap or 0,
        y = fonts.metric_label_y,
        w = spec.text_w, h = fonts.metric_line_height,
        text = part.text, font = fonts.metric_font,
        text_color = aiodi.colors.primary, floating = true,
    })
    return item, label, icon
end

local function verify_rendered_metric(metrics, fonts, item, label, icon, key, prose_baselines, test_label)
    local _, item_y = item:get_pos()
    local _, label_y = label:get_pos()
    local baseline = physical_baseline(item_y, label_y, fonts.metric_line_height, fonts.metric_base_line)
    expect_equal(baseline, item_y + fonts.shared_base_line,
        test_label .. " metric baseline drifted")
    for _, prose_baseline in ipairs(prose_baselines) do
        expect_equal(baseline, prose_baseline, test_label .. " prose/metric baseline drifted")
    end
    if not icon then
        return
    end

    local _, icon_y = icon:get_pos()
    local bounds = metrics.icons[key]
    local bitmap_y = icon_y + (metrics.icon_line_height - metrics.icon_base_line)
        - bounds.box_h - bounds.ofs_y
    local expected_y = (fonts.row_h - bounds.box_h) // 2 + metrics.icon_optical_offset_y
    expect_equal(bitmap_y, expected_y, test_label .. " rendered icon optical offset drifted")
    local bitmap_x = select(1, icon:get_pos()) + bounds.ofs_x
    expect_equal(bitmap_x, 0, test_label .. " rendered icon escaped its measured frame")
end

local function verify_rendered_plan(root, metrics, plan, test_label)
    root:clean()
    local row_y = 0
    for line_index, line in ipairs(plan.rows) do
        local row = lvgl.container(root, {
            x = 0, y = row_y, w = metrics.canvas_w, h = line.fonts.row_h,
            bg_opa = 0, border_width = 0, pad = 0,
            pad_column = line.fonts.word_gap,
        })
        row:set_scroll({ dir = "none", scrollbar = "off" })
        row:set_flex({
            flow = "row",
            main = "start",
            cross = "center",
        })
        local prose_baselines = {}
        local rendered_items = {}
        local rendered_metrics = {}
        for _, part in ipairs(line.parts) do
            if part.kind == "metric" then
                local item, label, icon = render_metric(metrics, row, part, line.fonts)
                rendered_items[#rendered_items + 1] = item
                rendered_metrics[#rendered_metrics + 1] = { item = item, label = label, icon = icon, key = part.key }
            else
                local item, label = render_prose(row, part, line.fonts)
                rendered_items[#rendered_items + 1] = item
                local _, item_y = item:get_pos()
                local _, label_y = label:get_pos()
                local baseline = physical_baseline(item_y, label_y,
                    line.fonts.prose_line_height, line.fonts.prose_base_line)
                expect_equal(baseline, item_y + line.fonts.shared_base_line,
                    string.format("%s line %d prose baseline drifted", test_label, line_index))
                prose_baselines[#prose_baselines + 1] = baseline
            end
        end
        for _, metric in ipairs(rendered_metrics) do
            verify_rendered_metric(metrics, line.fonts, metric.item, metric.label,
                metric.icon, metric.key, prose_baselines,
                string.format("%s line %d", test_label, line_index))
        end
        if #line.parts > 1 then
            local first_item_x = select(1, rendered_items[1]:get_pos())
            expect_equal(first_item_x, 0,
                string.format("%s line %d lost its left anchor", test_label, line_index))
            local previous_x = first_item_x
            local previous_width = layout.part_width(metrics, line.fonts, line.parts[1])
            for part_index = 2, #line.parts do
                local item_x = select(1, rendered_items[part_index]:get_pos())
                expect_equal(item_x, previous_x + previous_width + line.fonts.word_gap,
                    string.format("%s line %d did not keep one measured word space", test_label, line_index))
                previous_x = item_x
                previous_width = layout.part_width(metrics, line.fonts, line.parts[part_index])
            end
        end
        row_y = row_y + line.fonts.row_h + metrics.row_gap
    end
end

function module.on_start(ctx)
    assert(layout.runtime_values.events == "99 events,", "default events fixture must be 99")
    assert(layout.runtime_values.tasks == "99 tasks", "default tasks fixture must be 99")
    assert(layout.runtime_values.habit == "99 habits", "default habits fixture must be 99")
    assert(layout.runtime_values.focus == "99 focus", "default focus fixture must be 99")
    assert(layout.small_values.events == "3 events,", "small events fixture drifted")

    local metrics = layout.build_metrics(aiodi, 480, 800)
    local small = verify_plan_shape(metrics, layout.small_values, "small", { preferred = true })
    local runtime = verify_plan_shape(metrics, layout.runtime_values, "runtime", { preferred = true,
        flow = true })
    if #runtime.rows[1].parts ~= 2 or runtime.rows[1].template_id ~= "events" then
        fail("default opening sentence did not remain on one line")
    end
    if runtime.rows[1].parts[2].icon == false then
        fail("events icon was removed from the default Dashboard")
    end
    expect_equal(runtime.rows[1].width, layout.line_width(metrics, runtime.rows[1].fonts,
        runtime.rows[1].parts), "opening sentence width drifted")
    local habit_line = nil
    for _, line in ipairs(runtime.rows) do
        if line.template_id == "habit+today_available" then
            habit_line = line
            break
        end
    end
    if not habit_line then
        local rendered_rows = {}
        for _, line in ipairs(runtime.rows) do
            rendered_rows[#rendered_rows + 1] = string.format("%s=%d", line.template_id, line.width)
        end
        fail("habit did not share its row with today's opening phrase: " .. table.concat(rendered_rows, "; "))
    end
    for _, part in ipairs(habit_line.parts) do
        if part.kind == "metric" and part.key == "habit" and part.icon == false then
            fail("habit icon was removed from the default Dashboard")
        end
    end
    local extreme = verify_plan_shape(metrics, layout.extreme_values, "extreme", {
        preferred = true, flow = true, abbreviate = true,
    })

    local root = lvgl.container(ctx.root, {
        x = 0, y = 0, w = metrics.canvas_w, h = metrics.narrative_h,
        bg_opa = 0, border_width = 0, pad = 0,
    })
    root:set_scroll({ dir = "none", scrollbar = "off" })
    verify_rendered_plan(root, metrics, small, "small")
    verify_rendered_plan(root, metrics, runtime, "runtime")
    verify_rendered_plan(root, metrics, extreme, "extreme")

    layout.validate(metrics)
end

return module
