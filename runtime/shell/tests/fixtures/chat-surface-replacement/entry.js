// Static artwork, Shell styles, and fonts retain their public product contract.
;(function (root) {
  'use strict'

  root.odkRendererDevelopment.define({
    id: 'odk.tile.chat', manifest: { schemaVersion: 1, version: '2.0.0' },
    kind: 'tile', app: 'Chatbot', state: 'Pending integration', interaction: 'display-only',
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
      const layout = make('div', 'widget-status-layout')
      const icon = vector('svg', { class: 'widget-corner-icon', 'data-tabler': 'message', 'aria-hidden': 'true',
        viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
      for (const attributes of [{"stroke": "none", "d": "M0 0h24v24H0z", "fill": "none"}, {"d": "M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1"}]) icon.append(vector('path', attributes))
      layout.append(make('span', 'widget-status-name', 'Chatbot'), icon,
        make('strong', 'w-state widget-status-value', 'Pending'),
        make('span', 'widget-status-detail', 'Integration not available'))
      element.replaceChildren(layout)
    },
  })
})(window)
