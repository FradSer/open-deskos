;(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'odk.status.pi-sessions',
    manifest: { schemaVersion: 1 },
    kind: 'status',
    slot: 'left',
    mount(el, ctx) {
      el.innerHTML = `
        <button type="button" class="sb-pi-status flex items-center" id="sb-pi-status" aria-label="Pi sessions">
          <span class="sb-pi-dot"></span>
          <span class="sb-pi-label">PI</span>
          <span class="sb-pi-count" id="sb-pi-count">0</span>
        </button>`

      const btn = el.querySelector('#sb-pi-status')
      const dot = el.querySelector('.sb-pi-dot')
      const count = el.querySelector('#sb-pi-count')

      let tickCount = 0

      const refresh = async () => {
        if (typeof root.odkPlatform?.getPiSessions !== 'function') {
          count.textContent = '0'
          dot.className = 'sb-pi-dot'
          btn.setAttribute('aria-label', 'Pi sessions offline')
          return
        }
        try {
          const res = await root.odkPlatform.getPiSessions()
          const running = res?.summary?.running ?? 0
          count.textContent = String(running)
          if (running > 0) {
            dot.className = 'sb-pi-dot active'
            btn.classList.add('has-running')
            btn.setAttribute('aria-label', `${running} active Pi session${running > 1 ? 's' : ''}`)
          } else {
            dot.className = 'sb-pi-dot'
            btn.classList.remove('has-running')
            btn.setAttribute('aria-label', 'No active Pi sessions')
          }
        } catch {
          count.textContent = '0'
          dot.className = 'sb-pi-dot'
        }
      }

      btn.addEventListener('click', () => {
        ctx.navigateToPage?.('pi-sessions')
      })

      refresh()

      if (ctx?.onTick) {
        ctx.onTick(() => {
          tickCount += 1
          if (tickCount % 3 === 0) {
            refresh()
          }
        })
      }
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
