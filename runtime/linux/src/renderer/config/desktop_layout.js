;
(function (root) {
  'use strict'

  /*
   * Declarative desktop layout — the single place where pages exist and tiles
   * are placed. Home is a display-only five-column by three-row instrument
   * board; later pages are dedicated interactive App surfaces.
   */
  root.DESKTOP_LAYOUT = {
    pages: [
      { id: 'today', name: 'Today', kind: 'page', surface: 'display', plugin: 'odk.page.dashboard' },
      {
        id: 'home',
        name: 'Home',
        kind: 'grid',
        surface: 'display',
        widgets: [
          { id: 'odk.tile.almanac', col: '1', row: '1' },
          { id: 'odk.tile.clock', col: '2', row: '1' },
          { id: 'odk.tile.year', col: '3', row: '1' },
          { id: 'odk.tile.chat', col: '4', row: '1' },
          { id: 'odk.tile.settings', col: '5', row: '1' },
          { id: 'odk.tile.pomodoro', col: '1 / 3', row: '2 / 4' },
          { id: 'odk.tile.pi-sessions', col: '3', row: '2 / 4' },
          { id: 'odk.tile.face-presence', col: '4', row: '2' },
          { id: 'odk.tile.current-emotion', col: '4', row: '3' },
          { id: 'odk.tile.desk-status', col: '5', row: '2' },
        ],
      },
      { id: 'pi-sessions', name: 'Pi Sessions', kind: 'page', surface: 'app', plugin: 'odk.page.pi-sessions' },
      { id: 'quota', name: 'Usage', kind: 'page', surface: 'app', plugin: 'odk.page.quota' },
    ],
  }
})(typeof window !== 'undefined' ? window : globalThis)
