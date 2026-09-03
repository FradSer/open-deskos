;(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'odk.theme.pixel-art',
    name: 'Pixel Art (Retro Phosphor)',
    manifest: { schemaVersion: 1 },
    kind: 'theme',
    tokens: {
      '--radius': '0px',
      '--odk-radius-card': '0px',
      '--odk-radius-pill': '0px',
      '--stroke-w': '3px',
      '--odk-accent-green': '#38d948',
      '--odk-accent-red': '#f5a623',
      '--odk-surface': '#0e0e0e',
      '--odk-elevated': '#181818',
      '--odk-button': '#2a2a2a',
    },
    className: 'theme-pixel-art',
  })
})(typeof window !== 'undefined' ? window : globalThis)
