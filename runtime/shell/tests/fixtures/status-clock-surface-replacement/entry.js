;(function (root) {
  'use strict'

  root.odkRendererDevelopment.define({
    id: 'odk.status.clock', manifest: { schemaVersion: 1, version: '2.0.0' }, kind: 'status', slot: 'right',
    mount(element, context) {
      element.innerHTML = `<span class="sb-time">--:--</span>`
      const display = element.querySelector('.sb-time')
      context.onTick(date => {
        display.textContent = [date.getHours(), date.getMinutes()].map(value => (`0${value}`).slice(-2)).join(':')
      })
    },
  })
})(window)
