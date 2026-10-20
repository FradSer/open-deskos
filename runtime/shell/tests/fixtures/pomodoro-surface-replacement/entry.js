// Static artwork, Shell styles, and fonts retain their public product contract.
;(function (root) {
  'use strict'

  root.odkRendererDevelopment.define({
    id: 'odk.tile.pomodoro', manifest: { schemaVersion: 1, version: '2.0.0', minCell: 186 },
    kind: 'tile', app: 'Pomodoro', state: 'App timer', interaction: 'display-only', opensApp: 'pomodoro',
    mount(element) {
      const make = (tag, className, text) => {
        const node = document.createElement(tag)
        if (className) node.className = className
        if (text !== undefined) node.textContent = text
        return node
      }
      const vector = (tag, attributes) => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
        for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
        return node
      }
      const body = make('div', 'pomodoro-body widget-signal')
      const ring = make('div', 'pomodoro-ring-wrap')
      const artwork = vector('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' })
      for (const className of ['ring-track', 'ring-arc']) {
        artwork.append(vector('circle', { class: className, cx: '60', cy: '60', r: '50' }))
      }
      ring.append(artwork, make('span', 'ring-mmss', '--:--'), make('span', 'pomodoro-context', 'Focus'))
      body.append(ring)
      const heading = make('div', 'widget-head pomodoro-head')
      heading.append(make('span', 'widget-heading', 'Pomodoro'), make('span', 'pomodoro-state w-state', 'App timer'))
      element.replaceChildren(heading, body)
    },
  })
})(window)
