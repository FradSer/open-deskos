--
-- config/desktop_layout.lua -- Faithful AIODI Desktop Layout Configuration
--
-- Declarative definition of all home pages and multi-size widgets matching
-- the exact Figma AIODI Design System (Homepage / #0, #1, #2).
--
return {
    -- Page 1: Dashboard Flow (Homepage / #0 Today Narrative Stream)
    {
        type = "dashboard",
        title = "Dashboard",
    },

    -- Page 2: Core AIODI Widget Grid (Homepage / #1 3x4 Grid)
    {
        type = "grid",
        title = "Home",
        items = {
            -- Row 1: Date Tile (1x1, White bg, Red/Black text) + Clock Tile (2x1, Pure Black bg, 52px Bold)
            { plugin = "almanac",   widget = "1x1", col = 1, row = 1 },
            { plugin = "clock",     widget = "2x1", col = 2, row = 1 },

            -- Row 2: Chat Tile (1x1, Surface bg, Mail icon)
            { plugin = "chat",      widget = "1x1", col = 1, row = 2 },

            -- Row 2 & 3: Pomodoro Hero Ring (2x2, Surface bg, Red Progress Arc)
            { plugin = "pomodoro",  widget = "2x2", col = 2, row = 2 },

            -- Row 3: Calendar Tile (1x1, Blue bg, Calendar icon)
            { plugin = "calendar",  widget = "1x1", col = 1, row = 3 },

            -- Row 4: Year Progress Meter (2x1, Surface bg, Green fill) + Settings Tile (1x1, Focus border)
            { plugin = "year",      widget = "2x1", col = 1, row = 4 },
            { plugin = "settings",  widget = "1x1", col = 3, row = 4 },
        },
    },

    -- Page 3: OpenCode Go Agent Quota Card (Homepage / #2 Full 3x4 Grid Card)
    {
        type = "grid",
        title = "Quota",
        items = {
            { plugin = "quota",     widget = "3x4", col = 1, row = 1 },
        },
    },
}
