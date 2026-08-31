#!/usr/bin/env lua
--
-- aiodi_tokens.lua -- single-source generator for the AIODI design tokens.
--
-- aiodi.lua is the ONE source of truth for the palette / spacing / radius /
-- type scale. This script derives every consumer's representation from it so
-- the hand-synced copies (odk_voice_ui.c, sim_voice_ui.c, the web @theme, and
-- the aiodi.md docs) can never silently drift -- the way `stroke_focus` did
-- (absent from the linter whitelist, so generated UI using it was wrongly
-- rejected).
--
-- Modes:
--   lua aiodi_tokens.lua --emit c-linter   canonical linter palette[] body
--   lua aiodi_tokens.lua --emit c-prompt   canonical prompt palette C-string lines
--   lua aiodi_tokens.lua --emit css-theme  canonical AIODI @theme block (for the web UI)
--   lua aiodi_tokens.lua --check           parse consumers, exit non-zero on drift
--   lua aiodi_tokens.lua --write           rewrite the C consumer fragments in place
--
-- Adding a token: add it to aiodi.lua M.colors, then to COLOR_ORDER below, then
-- run `--write`. COLOR_ORDER is the single edit site -- it fixes the key order
-- (Lua tables are unordered) without duplicating any value.
--

-- Resolve the firmware root (parent of tools/) from arg[0], absolute.
local function firmware_root()
    local path = arg[0]
    if path:sub(1, 1) ~= "/" then
        local pwd = io.popen("pwd")
        if pwd then path = pwd:read("*l") .. "/" .. path; pwd:close() end
    end
    local dir = path:match("^(.*)/tools/aiodi_tokens%.lua$")
    if not dir then error("cannot locate firmware root from arg[0]: " .. path) end
    return dir
end

-- Stub lvgl so require("aiodi") loads without the firmware binding. aiodi.lua
-- only touches lvgl inside function bodies; at require time it just stores the
-- table, so an empty metatable-driven stub is enough.
package.preload["lvgl"] = function()
    return setmetatable({}, { __index = function(_, _) return function() end end })
end

local ROOT = firmware_root()
local LIB = ROOT .. "/components/lua_modules/lua_module_lvgl/lib"
package.path = LIB .. "/?.lua;" .. package.path

local aiodi = require("aiodi")

-- Canonical key order. THE single edit site when a token is added.
local COLOR_ORDER = {
    "bg", "surface", "elevated", "button", "stroke", "stroke_focus",
    "primary", "secondary", "red", "green", "blue",
}

local SPACE_ORDER  = { "xs", "sm", "md", "lg", "xl" }
local RADIUS_ORDER = { "sm", "md", "lg", "pill" }
local TEXT_ORDER   = { "caption", "body", "title", "display", "mega" }

-- Validate that COLOR_ORDER and M.colors agree exactly, then return the
-- ordered {name=, hex=} list. Errors loudly if a token exists on only one side.
local function colors_ordered()
    local seen = {}
    for _, k in ipairs(COLOR_ORDER) do
        if aiodi.colors[k] == nil then
            error("COLOR_ORDER lists '" .. k .. "' but aiodi.colors has no such key")
        end
        seen[k] = true
    end
    for k in pairs(aiodi.colors) do
        if not seen[k] then
            error("aiodi.colors has '" .. k .. "' but COLOR_ORDER does not -- add it")
        end
    end
    local out = {}
    for _, k in ipairs(COLOR_ORDER) do out[#out + 1] = { name = k, hex = aiodi.colors[k] } end
    return out
end

local function hex_bare(h) return h:gsub("^#", ""):lower() end

-- Unique bare hex values in COLOR_ORDER order (the linter whitelist is a set,
-- but kept in a stable order for readable diffs).
local function linter_palette()
    local out, seen = {}, {}
    for _, c in ipairs(colors_ordered()) do
        local b = hex_bare(c.hex)
        if not seen[b] then seen[b] = true; out[#out + 1] = b end
    end
    return out
end

local function emit_c_linter()
    local pal = linter_palette()
    local lines, i = {}, 1
    while i <= #pal do
        local chunk = {}
        for j = i, math.min(i + 4, #pal) do chunk[#chunk + 1] = string.format("%q", pal[j]) end
        lines[#lines + 1] = "        " .. table.concat(chunk, ", ") .. ","
        i = i + 5
    end
    lines[#lines] = lines[#lines]:gsub(",%s*$", ", NULL,")  -- sentinel on the last line
    return table.concat(lines, "\n")
end

-- The prompt palette: `name=#hex` tokens wrapped into C-string literal lines,
-- matching the indent/style of the existing prompt (2-space content indent on
-- the first line, 4-space on continuations; 4-space physical indent + quotes).
local function emit_c_prompt()
    local toks = {}
    for _, c in ipairs(colors_ordered()) do toks[#toks + 1] = c.name .. "=" .. c.hex end
    local prefix, cont, maxw = "  aiodi.colors: ", "    ", 74
    local lines, line, has_token = {}, prefix, false
    for _, t in ipairs(toks) do
        local candidate = has_token and (line .. " " .. t) or (line .. t)
        if #candidate > maxw and has_token then
            lines[#lines + 1] = line
            line = cont .. t
        else
            line = candidate
        end
        has_token = true
    end
    lines[#lines + 1] = line
    local out = {}
    for i, l in ipairs(lines) do out[i] = '    "' .. l .. '\\n"' end
    return table.concat(out, "\n")
end

local function emit_css_theme()
    local function line(name, val) return "  --a-" .. name .. ": " .. val .. ";" end
    local css = { "@theme {" }
    for _, c in ipairs(colors_ordered()) do
        css[#css + 1] = line("color-" .. c.name, c.hex)
    end
    css[#css + 1] = line("stroke", "var(--a-color-stroke)")
    local function scale(prefix, tbl, order, unit)
        for _, k in ipairs(order) do css[#css + 1] = line(prefix .. k, tbl[k] .. unit) end
    end
    scale("space-", aiodi.space, SPACE_ORDER, "px")
    scale("radius-", aiodi.radius, RADIUS_ORDER, "px")
    css[#css + 1] = line("font-sans", "'Montserrat', 'Noto Sans SC', system-ui, sans-serif")
    css[#css + 1] = "}"
    return table.concat(css, "\n")
end

-- --check: parse a consumer file and compare against the canonical.
local function read_file(p)
    local f = io.open(p, "r"); if not f then return nil end
    local s = f:read("*a"); f:close(); return s
end

-- Extract the linter palette entries (bare hex) from a C source blob.
local function parse_c_linter(src)
    local uses_generated_tokens = src:find("AIODI_LINTER_PALETTE", 1, true) ~= nil
    local i
    if uses_generated_tokens then
        src = read_file(ROOT .. "/components/lua_modules/lua_module_lvgl/src/aiodi_tokens.h") or src
        i = src:find("#define AIODI_LINTER_PALETTE", 1, true)
    else
        i = src:find("static const char *palette[] = {", 1, true)
    end
    if not i then return nil, "palette[] anchor not found" end
    local j = src:find("};", i, true)
    if not j then j = src:find("\n\n#endif", i, true) end
    if not j then return nil, "palette[] terminator not found" end
    local block = src:sub(i, j)
    local out = {}
    for hx in block:gmatch('"(%x%x%x%x%x%x)"') do out[#out + 1] = hx:lower() end
    return out
end

-- Extract the prompt palette tokens (ordered name->hex) from a C source blob.
local function parse_c_prompt(src)
    local uses_generated_tokens = src:find("AIODI_PROMPT_COLORS", 1, true) ~= nil
    local i
    if uses_generated_tokens then
        src = read_file(ROOT .. "/components/lua_modules/lua_module_lvgl/src/aiodi_tokens.h") or src
        i = src:find("aiodi%.colors:", 1, false)
    else
        i = src:find("aiodi%.colors:", 1, false)
    end
    if not i then return nil, "prompt 'aiodi.colors:' anchor not found" end
    local j = src:find("aiodi%.space:", i, false)
    if not j then return nil, "prompt 'aiodi.space:' anchor not found" end
    local block = src:sub(i, j)
    local out = {}
    for name, hx in block:gmatch("([%a_]+)=#(%x%x%x%x%x%x)") do out[#out + 1] = { name = name, hex = "#" .. hx:lower() } end
    return out
end

local function eq_list(a, b)
    if #a ~= #b then return false end
    for i = 1, #a do if a[i] ~= b[i] then return false end end
    return true
end

local function eq_tokens(a, b)
    if #a ~= #b then return false end
    for i = 1, #a do
        if a[i].name ~= b[i].name or a[i].hex:lower() ~= b[i].hex:lower() then return false end
    end
    return true
end

local function check()
    local c_files = {
        { name = "odk_voice_ui.c", path = ROOT .. "/application/open_deskos/main/odk_voice_ui.c" },
        { name = "sim_voice_ui.c", path = ROOT .. "/sim/native_sdl/sim_voice_ui.c" },
    }
    local want_linter = linter_palette()
    local want_prompt = colors_ordered()
    local drift = 0

    for _, cf in ipairs(c_files) do
        local src = read_file(cf.path)
        if not src then
            print(("  MISSING: %s (%s)"):format(cf.name, cf.path)); drift = drift + 1
        else
            local got_linter, err = parse_c_linter(src)
            if not got_linter then
                print(("  %s: linter parse failed: %s"):format(cf.name, err)); drift = drift + 1
            elseif not eq_list(got_linter, want_linter) then
                print(("  %s: linter palette drift"):format(cf.name))
                print(("    want: %s"):format(table.concat(want_linter, " ")))
                print(("    got:  %s"):format(table.concat(got_linter, " ")))
                drift = drift + 1
            end
            local got_prompt, perr = parse_c_prompt(src)
            if not got_prompt then
                print(("  %s: prompt parse failed: %s"):format(cf.name, perr)); drift = drift + 1
            elseif not eq_tokens(got_prompt, want_prompt) then
                print(("  %s: prompt palette drift"):format(cf.name))
                local function s(t) local r={} for _,x in ipairs(t) do r[#r+1]=x.name.."="..x.hex end return table.concat(r," ") end
                print(("    want: %s"):format(s(want_prompt)))
                print(("    got:  %s"):format(s(got_prompt)))
                drift = drift + 1
            end
        end
    end

    -- Web @theme: Phase 5 reconciles it; for now only report whether the AIODI
    -- accent is present (informational, not a hard drift).
    local css = read_file(ROOT .. "/application/open_deskos/components/http_server/frontend_source/src/index.css")
    if css and css:find("#eb5757", 1, true) then
        print("  web @theme: AIODI accent #eb5757 present (ok)")
    elseif css then
        print("  web @theme: still on fork defaults (no #eb5757) -- Phase 5 will reconcile")
    end

    if drift == 0 then print("aiodi_tokens: no drift") else print(("aiodi_tokens: %d drift(s) found"):format(drift)) end
    return drift
end

-- --write: rewrite the linter palette body and the prompt palette lines in both
-- C files. Anchored on the same markers --check parses, so the two can never
-- disagree about where the fragments live.
local function write_c_file(path)
    local src = read_file(path)
    if not src then error("cannot read " .. path) end
    local out = src

    -- Linter palette body: between `palette[] = {\n` and `\n    };`.
    do
        local anchor = "static const char *palette[] = {\n"
        local i = out:find(anchor, 1, true)
        if not i then error("linter open anchor not found in " .. path) end
        local j = out:find("\n    };", i, true)
        if not j then error("linter close anchor not found in " .. path) end
        out = out:sub(1, i + #anchor - 1) .. emit_c_linter() .. out:sub(j)
    end

    -- Prompt palette lines: the physical line starting `    "  aiodi.colors:`
    -- up to (not including) the physical line `    "  aiodi.space:`. The match
    -- includes the 4-space indent, so it lands on the line start.
    do
        local i = out:find('    "  aiodi%.colors:', 1, false)
        if not i then error("prompt 'aiodi.colors:' line not found in " .. path) end
        local j = out:find('\n    "  aiodi%.space:', i, false)
        if not j then error("prompt 'aiodi.space:' line not found in " .. path) end
        out = out:sub(1, i - 1) .. emit_c_prompt() .. "\n" .. out:sub(j + 1)
    end

    local f = io.open(path, "w")
    if not f then error("cannot write " .. path) end
    f:write(out); f:close()
    print("  wrote " .. path)
end

local function write_()
    write_c_file(ROOT .. "/application/open_deskos/main/odk_voice_ui.c")
    write_c_file(ROOT .. "/sim/native_sdl/sim_voice_ui.c")
    print("aiodi_tokens: consumers rewritten. Rebuild sim + IDF to pick up.")
end

-- Dispatch.
local mode = arg[1] or "--check"
if mode == "--emit" then
    local what = arg[2]
    if what == "c-linter" then io.write(emit_c_linter() .. "\n")
    elseif what == "c-prompt" then io.write(emit_c_prompt() .. "\n")
    elseif what == "css-theme" then io.write(emit_css_theme() .. "\n")
    else error("unknown --emit target: " .. tostring(what)) end
elseif mode == "--check" then
    os.exit(check() == 0 and 0 or 1)
elseif mode == "--write" then
    write_()
else
    error("unknown mode: " .. mode)
end
