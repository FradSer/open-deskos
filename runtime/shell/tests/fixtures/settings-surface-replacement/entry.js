// Static artwork, Shell styles, and fonts retain their public product contract.
;(function (root) {
  'use strict'

  root.odkRendererDevelopment.define({
    id: 'odk.tile.settings', manifest: { schemaVersion: 1, version: '2.0.0' },
    kind: 'tile', app: 'Settings', state: 'Pending integration', interaction: 'display-only',
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
      const icon = vector('svg', { class: 'widget-corner-icon', 'data-tabler': 'settings', 'aria-hidden': 'true',
        viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
      for (const attributes of [{"stroke": "none", "d": "M0 0h24v24H0z", "fill": "none"}, {"d": "M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065"}, {"d": "M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"}]) icon.append(vector('path', attributes))
      layout.append(make('span', 'widget-status-name', 'Settings'), icon,
        make('strong', 'w-state widget-status-value', 'Pending'),
        make('span', 'widget-status-detail', 'Integration not available'))
      element.replaceChildren(layout)
    },
  })
})(window)
