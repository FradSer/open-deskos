// Static artwork, Shell styles, and fonts retain their public product contract.
;(function (root) {
  'use strict'

  root.odkRendererDevelopment.define({
    id: 'odk.tile.pomodoro', manifest: { schemaVersion: 1, version: '2.0.0', minCell: 186 },
    kind: 'tile', app: 'Pomodoro', state: 'App timer', interaction: 'display-only', opensApp: 'pomodoro',
    mount(element, context = {}) {
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
      const state = make('span', 'pomodoro-state w-state', 'App timer')
      const lane = make('div', 'pomodoro-lane')
      const ring = make('div', 'pomodoro-ring-wrap')
      const artwork = vector('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' })
      for (const className of ['ring-track', 'ring-arc']) {
        artwork.append(vector('circle', { class: className, cx: '60', cy: '60', r: '50' }))
      }
      ring.append(artwork, make('span', 'ring-mmss', '--:--'), make('span', 'pomodoro-context', 'Focus'))
      lane.append(ring)
      body.append(state, lane)
      element.replaceChildren(body)
      if (!context.onTick || !context.trackCleanup) return
      const time = ring.querySelector('.ring-mmss')
      const arc = artwork.querySelector('.ring-arc')
      let active = true, provider = null, release = null
      context.trackCleanup(() => { active = false; release?.(); release = null })
      // The dial carries the reading; the App's own state word sits above it, and an
      // idle session states nothing instead of a Ready label.
      function setState(label) {
        if (state.textContent !== label) state.textContent = label
        const hidden = !label
        if (state.hidden !== hidden) state.hidden = hidden
      }
      function paint(value) {
        if (!active) return
        setState(value.mode === 'idle' ? '' : value.state)
        if (time.textContent !== value.time) time.textContent = value.time
        arc.style.strokeDashoffset = String(314 * Math.max(0, Math.min(1, value.remaining / value.duration)))
      }
      function updateReading() {
        if (!active) return
        const current = context.focus
        if (provider !== current) {
          release?.(); release = null; provider = current
          if (current) release = current.subscribe(value => { if (context.focus === current) paint(value) })
        }
        if (current) paint(current.snapshot())
        else { if (time.textContent !== '--:--') time.textContent = '--:--'; setState('App timer'); arc.style.strokeDashoffset = '314' }
      }
      context.onTick(updateReading)
      updateReading()
    },
  })
})(window)
