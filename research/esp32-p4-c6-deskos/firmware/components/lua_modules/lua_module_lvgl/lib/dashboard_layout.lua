local M = {}

-- Every Dashboard narrative row uses one shared display scale. Overflow is
-- resolved through declared semantic reflow, never smaller mixed-size text.
M.preferred_text_size = 26
M.compact_text_size = 16
M.compact_width_threshold = 320
M.compact_height_threshold = 320
-- Compact S3 metrics apply only to a genuinely small canvas; the P4 keeps
-- the reference 3x4-sized Dashboard geometry.
-- Inline symbols intentionally sit below the prose scale: actual glyph-width
-- measurement keeps calendar and habit visible without stealing an entire
-- semantic line from their adjacent text.
M.icon_size = 20
M.icon_gap = 2
M.icon_optical_offset_y = 2
M.header_h = 64

M.glyphs = {
    events = 0xF133,
    tasks = 0xF046,
    habit = 0xF0C2,
    focus = 0xF254,
}

M.small_values = {
    events = "3 events,",
    tasks = "2 tasks",
    habit = "1 habit",
    availability = "You're mostly free",
    after = "after 4 pm.",
    focus = "99 focus",
}

-- The default visual fixture is intentionally dense. The planner uses it on
-- device until calendar, task, and habit bridges provide real values.
M.runtime_values = {
    events = "99 events,",
    tasks = "99 tasks",
    habit = "99 habits",
    availability = "You're mostly free",
    after = "after 4 pm.",
    focus = "99 focus",
}

M.extreme_values = {
    events = "999 events,",
    tasks = "999 tasks",
    habit = "999 habits",
    availability = "You're overwhelmingly booked for the entire day and night",
    after = "after midnight.",
    focus = "9999999999999999999999999999 focus",
}

-- A semantic group is the smallest unit the flow planner may move across a
-- line boundary. Groups remain in source order; their contained fragments use
-- one measured prose-font space and are never arbitrarily word-wrapped.
M.flow_groups = {
    {
        id = "events",
        parts = {
            { kind = "text", value = "You have" },
            { kind = "metric", key = "events" },
        },
    },
    {
        id = "tasks_and",
        parts = {
            { kind = "metric", key = "tasks" },
            { kind = "text", value = "and" },
        },
    },
    {
        id = "habit",
        parts = {
            { kind = "metric", key = "habit" },
        },
    },
    {
        id = "today_available",
        parts = {
            { kind = "text", value = "today_available", dynamic = true },
        },
    },
    {
        id = "availability_tail",
        parts = {
            { kind = "text", value = "availability_tail", dynamic = true },
        },
    },
    {
        id = "after",
        parts = {
            { kind = "text", value = "after", dynamic = true },
        },
    },
    {
        id = "focus",
        parts = {
            { kind = "metric", key = "focus" },
        },
    },
}

local function fail(message)
    error("dashboard layout: " .. message)
end

local function px(aiodi, value)
    return aiodi.px(value)
end

local function copy_part(part)
    return {
        kind = part.kind,
        key = part.key,
        icon = part.icon,
        value = part.value,
        text = part.text,
        dynamic = part.dynamic,
    }
end

local function copy_range(parts, first, last)
    local copy = {}
    for index = first, last do
        copy[#copy + 1] = copy_part(parts[index])
    end
    return copy
end

local function copy_strings(values)
    local copy = {}
    for _, value in ipairs(values) do
        copy[#copy + 1] = value
    end
    return copy
end

local function font_key(size, face)
    return string.format("dashboard-%s-%d", face, size)
end

local function glyph_bounds(icon_font, glyph, name)
    local advance, box_w, box_h, ofs_x, ofs_y, base_line =
        icon_font:glyph_bounds(utf8.char(glyph))
    if not advance or box_w <= 0 or box_h <= 0 then
        fail(string.format("could not measure glyph bounds for %s", name))
    end
    return {
        advance = advance,
        box_w = box_w,
        box_h = box_h,
        ofs_x = ofs_x,
        ofs_y = ofs_y,
        base_line = base_line,
    }
end

local function build_icon_metrics(aiodi)
    local font = aiodi.icon_font(px(aiodi, M.icon_size), { cache_size = 8 })
    if not font then
        fail("Dashboard icon font is unavailable")
    end
    local icons = {}
    for name, glyph in pairs(M.glyphs) do
        icons[name] = glyph_bounds(font, glyph, name)
    end
    return font, icons
end

function M.build_metrics(aiodi, canvas_w, canvas_h)
    local resolved_w = canvas_w or _G.WIDTH or 480
    local resolved_h = canvas_h or _G.HEIGHT or 800
    local compact = resolved_w <= M.compact_width_threshold
        and resolved_h <= M.compact_height_threshold
    local icon_size = compact and 16 or M.icon_size
    local icon_font = aiodi.icon_font(px(aiodi, icon_size), { cache_size = 8 })
    if not icon_font then
        fail("Dashboard icon font is unavailable")
    end
    local icons = {}
    for name, glyph in pairs(M.glyphs) do
        icons[name] = glyph_bounds(icon_font, glyph, name)
    end
    local icon_base_line = icons.events.base_line
    for name, icon in pairs(icons) do
        if icon.base_line ~= icon_base_line then
            fail(string.format("icon baselines drift: %s=%d/%d", name,
                icon.base_line, icon_base_line))
        end
    end
    return {
        aiodi = aiodi,
        canvas_w = resolved_w,
        canvas_h = resolved_h,
        icon_font = icon_font,
        icon_line_height = icon_font:line_height(),
        icon_base_line = icon_base_line,
        icons = icons,
        compact = compact,
        text_size = compact and M.compact_text_size or M.preferred_text_size,
        icon_size = px(aiodi, icon_size),
        icon_gap = px(aiodi, compact and 1 or M.icon_gap),
        icon_optical_offset_y = px(aiodi, M.icon_optical_offset_y),
        row_gap = compact and 0 or aiodi.space.md,
        header_h = px(aiodi, compact and 32 or M.header_h),
        font_cache = {},
        narrative_h = resolved_h - px(aiodi, compact and 32 or M.header_h)
            - (compact and 0 or aiodi.space.md),
        grid_layout = compact and "2x2" or "3x4",
    }
end

function M.font_metrics(metrics, size)
    local cached = metrics.font_cache[size]
    if cached then
        return cached
    end
    local bold = metrics.aiodi.font_bold(px(metrics.aiodi, size), {
        cache_size = 16,
        cache_tag = font_key(size, "metric"),
    })
    local prose = metrics.aiodi.font(px(metrics.aiodi, size), {
        cache_size = 16,
        cache_tag = font_key(size, "prose"),
    })
    if not bold or not prose then
        fail("Dashboard text font is unavailable")
    end
    local bold_line_height = bold:line_height()
    local prose_line_height = prose:line_height()
    local bold_base_line = select(6, bold:glyph_bounds("M"))
    local prose_base_line = select(6, prose:glyph_bounds("M"))
    local row_h = math.max(bold_line_height, prose_line_height)
    local shared_base_line = row_h - bold_base_line
    local metric_label_y = shared_base_line - (bold_line_height - bold_base_line)
    local prose_label_y = shared_base_line - (prose_line_height - prose_base_line)
    if metric_label_y < 0 or prose_label_y < 0 then
        fail("shared text baseline falls outside the narrative row")
    end
    cached = {
        size = size,
        metric_font = bold,
        prose_font = prose,
        metric_line_height = bold_line_height,
        prose_line_height = prose_line_height,
        metric_base_line = bold_base_line,
        prose_base_line = prose_base_line,
        row_h = row_h,
        shared_base_line = shared_base_line,
        metric_label_y = metric_label_y,
        prose_label_y = prose_label_y,
        word_gap = prose:measure(" "),
    }
    metrics.font_cache[size] = cached
    return cached
end

function M.metric_measure(metrics, fonts, key, text)
    local width = fonts.metric_font:measure(text)
    if not width or width <= 0 then
        fail(string.format("could not measure metric %q", text))
    end
    return {
        key = key,
        text = text,
        text_w = width,
    }
end

local function resolve_text(values, value)
    if value == "today_available" then
        local opening = values.availability:match("^(%S+)")
        return "today. " .. (opening or "")
    end
    if value == "availability_tail" then
        return values.availability:match("^%S+%s+(.+)$") or ""
    end
    if value == "after" then
        return values.after
    end
    return value
end

function M.values_signature(values)
    values = values or M.runtime_values
    return table.concat({
        values.events, values.tasks, values.habit,
        values.availability, values.after, values.focus,
    }, "\31")
end

function M.resolve_parts(template, values)
    local resolved = {}
    for _, part in ipairs(template.parts) do
        if part.kind == "metric" then
            resolved[#resolved + 1] = {
                kind = "metric",
                key = part.key,
                icon = part.icon,
                text = values[part.key],
            }
        else
            resolved[#resolved + 1] = {
                kind = "text",
                text = part.dynamic and resolve_text(values, part.value) or part.value,
            }
        end
    end
    return resolved
end

local function resolve_line_parts(parts, values)
    local resolved = {}
    for _, part in ipairs(parts) do
        if part.kind == "metric" then
            resolved[#resolved + 1] = {
                kind = "metric",
                key = part.key,
                icon = part.icon,
                text = part.text or values[part.key],
            }
        else
            local text = part.text or (part.dynamic and resolve_text(values, part.value) or part.value)
            if text ~= "" then
                resolved[#resolved + 1] = { kind = "text", text = text }
            end
        end
    end
    return resolved
end

function M.resolve_group_parts(group, values)
    return resolve_line_parts(group.parts, values)
end

function M.icon_width(metrics, icon_name)
    local icon = metrics.icons[icon_name]
    if not icon then
        fail("missing icon metrics for " .. tostring(icon_name))
    end
    return icon.box_w
end

function M.part_width(metrics, fonts, part)
    if part.kind == "metric" then
        local text_width = M.metric_measure(metrics, fonts, part.key, part.text).text_w
        if part.icon == false then
            return text_width
        end
        return M.icon_width(metrics, part.key) + metrics.icon_gap + text_width
    end
    local width = fonts.prose_font:measure(part.text)
    if not width or width <= 0 then
        fail(string.format("could not measure prose %q", part.text))
    end
    return width
end

function M.line_width(metrics, fonts, parts)
    local width = 0
    for index, part in ipairs(parts) do
        if index > 1 then
            width = width + fonts.word_gap
        end
        width = width + M.part_width(metrics, fonts, part)
    end
    return width
end

local function text_prefix(text, count)
    local next_start = utf8.offset(text, count + 1)
    return next_start and text:sub(1, next_start - 1) or text
end

local function abbreviate_text(font, text, max_width)
    if font:measure(text) <= max_width then
        return text, false
    end
    local suffix = "..."
    if font:measure(suffix) > max_width then
        fail("ellipsis cannot fit the Dashboard container")
    end
    local length = assert(utf8.len(text), "Dashboard text must be valid UTF-8")
    local low, high, best = 0, length, ""
    while low <= high do
        local middle = (low + high) // 2
        local candidate = text_prefix(text, middle) .. suffix
        if font:measure(candidate) <= max_width then
            best = candidate
            low = middle + 1
        else
            high = middle - 1
        end
    end
    return best, true
end

local function fit_or_abbreviate_parts(metrics, parts)
    local fonts = M.font_metrics(metrics, metrics.text_size)
    local width = M.line_width(metrics, fonts, parts)
    if width <= metrics.canvas_w then
        return { parts = parts, fonts = fonts, width = width, abbreviated = false }
    end

    local target_index, target_width = nil, -1
    for index, part in ipairs(parts) do
        local part_width = M.part_width(metrics, fonts, part)
        if part_width > target_width then
            target_index, target_width = index, part_width
        end
    end
    local target = parts[target_index]
    local remaining_width = metrics.canvas_w - (#parts - 1) * fonts.word_gap
    for index, part in ipairs(parts) do
        if index ~= target_index then
            remaining_width = remaining_width - M.part_width(metrics, fonts, part)
        end
    end
    if target.kind == "metric" and target.icon ~= false then
        remaining_width = remaining_width - M.icon_width(metrics, target.key) - metrics.icon_gap
    end
    local font = target.kind == "metric" and fonts.metric_font or fonts.prose_font
    local text = abbreviate_text(font, target.text, remaining_width)
    local abbreviated_parts = copy_range(parts, 1, #parts)
    abbreviated_parts[target_index].text = text
    width = M.line_width(metrics, fonts, abbreviated_parts)
    if width <= metrics.canvas_w then
        return {
            parts = abbreviated_parts,
            fonts = fonts,
            width = width,
            abbreviated = true,
        }
    end
    fail("Dashboard semantic group cannot fit its container")
end

local function append_parts(destination, parts)
    for _, part in ipairs(parts) do
        destination[#destination + 1] = part
    end
end

local function flush_line(plan, parts, group_ids, abbreviated)
    if #parts == 0 then
        return
    end
    local fonts = M.font_metrics(plan.metrics, plan.metrics.text_size)
    local width = M.line_width(plan.metrics, fonts, parts)
    plan.rows[#plan.rows + 1] = {
        template_id = table.concat(group_ids, "+"),
        group_ids = copy_strings(group_ids),
        mode = abbreviated and "abbreviate" or "flow",
        parts = parts,
        fonts = fonts,
        width = width,
        abbreviated = abbreviated,
    }
end

function M.plan(metrics, values)
    values = values or M.runtime_values
    local plan = {
        metrics = metrics,
        rows = {},
        preferred_size = M.preferred_text_size,
        alignment = "start",
    }
    local line_parts, line_group_ids = {}, {}
    local line_abbreviated = false

    for _, group in ipairs(M.flow_groups) do
        local parts = M.resolve_group_parts(group, values)
        if #parts > 0 then
            local candidate = copy_range(line_parts, 1, #line_parts)
            append_parts(candidate, parts)
            local fonts = M.font_metrics(metrics, metrics.text_size)
            if #line_parts > 0 and M.line_width(metrics, fonts, candidate) > metrics.canvas_w then
                flush_line(plan, line_parts, line_group_ids, line_abbreviated)
                line_parts, line_group_ids, line_abbreviated = {}, {}, false
            end
            if #line_parts == 0 then
                local fitted = fit_or_abbreviate_parts(metrics, parts)
                line_parts = fitted.parts
                line_group_ids = { group.id }
                line_abbreviated = fitted.abbreviated
            else
                append_parts(line_parts, parts)
                line_group_ids[#line_group_ids + 1] = group.id
            end
        end
    end
    flush_line(plan, line_parts, line_group_ids, line_abbreviated)
    plan.metrics = nil
    return plan
end

function M.inline_icon_frame(metrics, fonts, icon_name)
    local icon = metrics.icons[icon_name]
    if not icon then
        fail("missing icon metrics for " .. tostring(icon_name))
    end
    return {
        x = -icon.ofs_x,
        y = (fonts.row_h - icon.box_h) // 2
            - (metrics.icon_line_height - metrics.icon_base_line)
            + icon.box_h + icon.ofs_y + metrics.icon_optical_offset_y,
        w = icon.box_w,
        h = metrics.icon_line_height,
    }
end

local function validate_icon(metrics, fonts, icon_name)
    local frame = M.inline_icon_frame(metrics, fonts, icon_name)
    local icon = metrics.icons[icon_name]
    local bitmap_x = frame.x + icon.ofs_x
    local bitmap_y = frame.y + (metrics.icon_line_height - metrics.icon_base_line)
        - icon.box_h - icon.ofs_y
    local expected_x = 0
    local expected_y = (fonts.row_h - icon.box_h) // 2 + metrics.icon_optical_offset_y
    if bitmap_x ~= expected_x or bitmap_y ~= expected_y then
        fail(string.format("icon %s bitmap is not centered: %d,%d expected %d,%d",
            icon_name, bitmap_x, bitmap_y, expected_x, expected_y))
    end
    if bitmap_x < 0 or bitmap_x + icon.box_w > M.icon_width(metrics, icon_name) then
        fail(string.format("icon %s bitmap escapes its measured frame", icon_name))
    end
    if bitmap_y < 0 or bitmap_y + icon.box_h > fonts.row_h then
        fail(string.format("icon %s bitmap escapes its text line", icon_name))
    end
end

local function validate_line(metrics, line, label, index)
    if line.width > metrics.canvas_w then
        fail(string.format("%s line %d overflows: %d/%d", label, index,
            line.width, metrics.canvas_w))
    end
    local fonts = line.fonts
    local metric_baseline = fonts.metric_label_y + fonts.metric_line_height - fonts.metric_base_line
    local prose_baseline = fonts.prose_label_y + fonts.prose_line_height - fonts.prose_base_line
    if metric_baseline ~= fonts.shared_base_line or prose_baseline ~= fonts.shared_base_line then
        fail(string.format("%s line %d baseline drifted", label, index))
    end
    for _, part in ipairs(line.parts) do
        if part.kind == "metric" and part.icon ~= false then
            validate_icon(metrics, fonts, part.key)
        end
    end
end

function M.validate(metrics)
    local small = M.plan(metrics, M.small_values)
    local runtime = M.plan(metrics, M.runtime_values)
    local extreme = M.plan(metrics, M.extreme_values)
    local plans = { small = small, runtime = runtime, extreme = extreme }
    for label, plan in pairs(plans) do
        local height = 0
        for index, line in ipairs(plan.rows) do
            if line.fonts.size ~= metrics.text_size then
                fail(string.format("%s line %d changed Dashboard type scale: %d/%d",
                    label, index, line.fonts.size, metrics.text_size))
            end
            validate_line(metrics, line, label, index)
            height = height + line.fonts.row_h
            if index > 1 then
                height = height + metrics.row_gap
            end
            print(string.format("DASH %s line%d=%d/%d size=%d", label, index,
                line.width, metrics.canvas_w, line.fonts.size))
        end
        if height > metrics.narrative_h then
            fail(string.format("%s narrative is %dpx tall; available=%d", label,
                height, metrics.narrative_h))
        end
        print(string.format("DASH %s=pass lines=%d height=%d/%d", label,
            #plan.rows, height, metrics.narrative_h))
    end
    return runtime, extreme
end

return M
