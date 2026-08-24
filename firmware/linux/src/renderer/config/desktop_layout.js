;
(function (root) {
  'use strict'

  /*
   * Declarative desktop layout — the single place where pages exist and tiles
   * are placed. Mirrors firmware desktop_layout.lua: clock spans 2 columns,
   * pomodoro spans 2x2, year fills the full bottom row.
   * AI-generated features: register a plugin, add one entry here. Nothing
   * else changes.
   */
  root.DESKTOP_LAYOUT = {
    pages: [
      { id: 'dashboard', name: '概览', kind: 'page', plugin: 'dashboard-page' },
      {
        id: 'home',
        name: '应用',
        kind: 'grid',
        widgets: [
          { id: 'almanac', col: '1', row: '1' },
          { id: 'clock', col: '2 / 4', row: '1' },
          { id: 'chat', col: '3', row: '2' },
          { id: 'pomodoro', col: '1 / 3', row: '2 / 4' },
          { id: 'settings', col: '3', row: '3' },
          { id: 'year', col: '1 / 4', row: '4' },
        ],
      },
      { id: 'quota', name: '用量', kind: 'page', plugin: 'quota-page' },
    ],
  }
})(typeof window !== 'undefined' ? window : globalThis)
