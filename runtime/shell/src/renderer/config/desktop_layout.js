;
(function (root) {
  'use strict'

  /*
   * Declarative desktop layout — the single place where pages exist and tiles
   * are placed. The Agent has a resident host. Home contains its briefing host. Widget pages share measured
   * cells; App pages keep their existing interactive surfaces.
   */
  root.DESKTOP_LAYOUT = {
    pages: [
      { id: 'personal-agent', name: 'Personal Agent', kind: 'page', surface: 'app', plugin: 'odk.page.personal-agent', persistent: 'personal-agent' },
      { id: 'today', name: 'Today', kind: 'page', surface: 'display', plugin: 'odk.page.dashboard', persistent: 'home-summary' },
      {
        id: 'home',
        name: 'Home',
        kind: 'grid',
        surface: 'display',
        widgets: [
          { id: 'odk.tile.pi-sessions', col: '1', row: '1' },
          { id: 'odk.tile.pomodoro', col: '2', row: '1' },
          { id: 'odk.tile.futu', col: '3', row: '1' },
          { id: 'odk.tile.weather', col: '2', row: '2' },
          { id: 'odk.tile.year', col: '1', row: '2' },
        ],
      },
      { id: 'desk', name: 'Desk', kind: 'grid', surface: 'display', widgets: [
        { id: 'odk.tile.hydra', col: '1', row: '1 / 3' },
      ] },
      { id: 'reading', name: 'Reading', kind: 'grid', surface: 'display', widgets: [
        { id: 'odk.tile.weread', col: '1 / 3', row: '1 / 3' },
        { id: 'odk.tile.preorder', col: '3', row: '1' },
      ] },
      { id: 'pi-sessions', name: 'Pi Sessions', kind: 'page', surface: 'app', plugin: 'odk.page.pi-sessions' },
      { id: 'quota', name: 'Usage', kind: 'page', surface: 'app', plugin: 'odk.page.quota' },
    ],
  }
})(typeof window !== 'undefined' ? window : globalThis)
