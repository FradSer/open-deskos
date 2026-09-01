;
(function (root) {
  'use strict'

  /*
   * Declarative desktop layout — the single place where pages exist and tiles
   * are placed. Mirrors firmware desktop_layout.lua: clock spans 2 columns,
   * pomodoro spans 2x2, year fills the full bottom row.
   * New features: register a plugin, add one entry here. Nothing
   * else changes.
   */
  root.DESKTOP_LAYOUT = {
    pages: [
      { id: 'today', name: 'Today', kind: 'page', plugin: 'odk.page.dashboard' },
      {
        id: 'home',
        name: 'Home',
        kind: 'grid',
        widgets: [
          { id: 'odk.tile.almanac', col: '1', row: '1', route: 'today' },
          { id: 'odk.tile.clock', col: '2 / 4', row: '1', route: 'now' },
          { id: 'odk.tile.pomodoro', col: '1 / 3', row: '2 / 4', route: 'today' },
          { id: 'odk.tile.year', col: '1 / 4', row: '4 / 6' },
        ],
      },
      { id: 'quota', name: 'Usage', kind: 'page', plugin: 'odk.page.quota' },
    ],
  }
})(typeof window !== 'undefined' ? window : globalThis)
