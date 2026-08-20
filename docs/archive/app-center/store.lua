-- store.lua - App Center package catalog (store stub).
--
-- A fixed list of catalog entries mirroring the App manifest shape (id,
-- version, description) plus the Lua module the sandbox runs when opened.
-- This is the seam a real store backend will plug into: swap this module for
-- one that fetches entries from a store endpoint, while the App Manager and
-- sandbox contract stay unchanged.
--
-- `src` follows the canonical App contract (see apps/pomodoro.lua): it returns
-- an App module with on_start/on_tick/on_stop callbacks.
local aiodi = require("aiodi")
local ICONS = _G.ICONS

return {
  { id = "settings", name = "Settings", desc = "System settings",
    version = "1.0.0", author = "Cerb Labs", size = "2 KB",
    icon = ICONS.settings, svg = "settings", accent = aiodi.colors.bg, src = require("apps.settings") },
  { id = "breath", name = "Breath", desc = "4-second breathing guide",
    version = "1.0.0", author = "Cerb Labs", size = "2 KB",
    icon = ICONS.power, svg = "leaf", accent = aiodi.colors.blue, src = require("apps.breath") },
  { id = "mantra", name = "Mantra", desc = "Slow rotating quotes",
    version = "1.2.0", author = "Cerb Labs", size = "3 KB",
    icon = ICONS.bell, svg = "bell", accent = aiodi.colors.green, src = require("apps.mantra") },
  { id = "dice", name = "Dice", desc = "Tap to roll a die",
    version = "1.0.0", author = "Cerb Labs", size = "1 KB",
    icon = ICONS.shuffle, svg = "dice", accent = aiodi.colors.red, src = require("apps.dice") },
  { id = "hydrate", name = "Hydrate", desc = "Daily water counter",
    version = "1.1.0", author = "Cerb Labs", size = "2 KB",
    icon = ICONS.tint, svg = "droplet", accent = aiodi.colors.blue, src = require("apps.hydrate") },
  { id = "stars", name = "Stars", desc = "Tap to collect stars",
    version = "1.0.0", author = "Cerb Labs", size = "1 KB",
    icon = ICONS.bullet, svg = "star", accent = aiodi.colors.green, src = require("apps.stars") },
  { id = "almanac", name = "黄曆", desc = "香港黃曆／通勝",
    version = "1.0.0", author = "Cerb Labs", size = "14 KB",
    icon = ICONS.bars, svg = "calendar", accent = aiodi.colors.primary, src = require("apps.almanac") },
}
