;(function (root) {
  'use strict'
  root.odkPlugins.register({
    id: 'odk.app.devices', manifest: { schemaVersion: 1 }, kind: 'app', appId: 'devices',
    app: 'Devices', name: 'Devices', appKind: 'ui', source: 'builtin', capabilities: [],
    css: 'plugins/reading-apps.css',
    mount(el, ctx) {
      el.innerHTML = '<section class="runtime-app reading-app"><h2>Devices</h2><p class="reading-status" role="status" aria-live="polite">Checking Bridge…</p><dl class="reading-values" data-gateway></dl><p class="reading-status" data-remote-status role="status" aria-live="polite">Checking S3…</p><dl class="reading-values" data-peers></dl><div class="reading-head"><button type="button" class="button-pill button-secondary" data-refresh>Refresh</button><button type="button" class="button-pill button-secondary" data-ping disabled>Check gateway</button></div><p class="app-detail" data-result role="status" aria-live="polite"></p></section>'
      const status = el.querySelector('.reading-status')
      const values = el.querySelector('[data-gateway]')
      const peers = el.querySelector('[data-peers]')
      const remoteStatus = el.querySelector('[data-remote-status]')
      const refreshButton = el.querySelector('[data-refresh]')
      const pingButton = el.querySelector('[data-ping]')
      const result = el.querySelector('[data-result]')
      let released = false; let pending = false; let acting = false; let live = false
      const labels = {
        unconfigured: 'Select a NanoC6 gateway in the Bridge configuration, then refresh.',
        unavailable: 'Gateway unavailable. Check Bridge and the NanoC6 connection, then refresh.',
        disconnected: 'Bridge disconnected. Check the Bridge service, then refresh.',
      }
      const row = (list, name, value) => {
        const item = document.createElement('div')
        const term = document.createElement('dt'); term.textContent = name
        const definition = document.createElement('dd'); definition.textContent = String(value ?? 'Unavailable')
        item.append(term, definition); list.append(item)
      }
      async function refresh() {
        if (released || pending || acting) return
        pending = true; refreshButton.disabled = true
        try {
          const snapshot = await root.odkPlatform?.getDeviceGateway?.()
          if (released) return
          live = snapshot?.status === 'live' && snapshot.gateway?.status === 'live'
          if (!live) result.textContent = ''
          status.textContent = live ? 'NanoC6 connected through Bridge.' : (labels[snapshot?.status] || labels.unavailable)
          values.replaceChildren()
          peers.replaceChildren()
          remoteStatus.textContent = 'S3 disconnected. Remote control is unavailable.'
          if (live) {
            const gateway = snapshot.gateway
            for (const [name, value] of [['Gateway', 'M5Stack NanoC6'], ['USB identity', gateway.serialNumber], ['MAC address', gateway.mac], ['Firmware', gateway.firmware], ['Radio channel', gateway.channel], ['Paired devices', Array.isArray(snapshot.peers) ? snapshot.peers.length : 0]]) row(values, name, value)
            const remote = snapshot.remote
            if (remote?.status === 'ready') remoteStatus.textContent = 'S3 ready. Desktop state acknowledged.'
            else if (remote?.status === 'syncing') remoteStatus.textContent = 'S3 synchronizing. Waiting for desktop state acknowledgement.'
            else if (!remote?.mac) remoteStatus.textContent = 'S3 not configured.'
            for (const peer of Array.isArray(snapshot.peers) ? snapshot.peers.slice(0, 7) : []) {
              const name = peer.role === 'remote' ? 'S3 Remote' : 'ESP-NOW device'
              row(peers, name, peer.mac)
              if (peer.role !== 'remote') row(peers, 'Device state', peer.status === 'stale' ? 'Paired. No recent packets.' : peer.lastSeen ? 'Paired. Packet received.' : 'Paired. No packet received.')
            }
          }
        } catch {
          if (!released) { live = false; status.textContent = labels.unavailable; remoteStatus.textContent = 'S3 state unavailable.'; values.replaceChildren(); peers.replaceChildren() }
        } finally {
          pending = false
          if (!released) { refreshButton.disabled = false; pingButton.disabled = !live || acting }
        }
      }
      async function ping() {
        if (released || acting || !live) return
        acting = true; pingButton.disabled = true; refreshButton.disabled = true; result.textContent = 'Checking gateway…'
        try {
          const reply = await root.odkPlatform.deviceGatewayAction({ type: 'ping' })
          if (!released) result.textContent = reply?.ok ? 'Gateway reply received.' : 'No gateway reply. Check the connection, then refresh.'
        } catch { if (!released) result.textContent = 'Gateway check unavailable. Refresh to try again.' }
        finally { acting = false; if (!released) { pingButton.disabled = !live; refreshButton.disabled = pending } }
      }
      refreshButton.addEventListener('click', refresh)
      pingButton.addEventListener('click', ping)
      ctx.trackCleanup(() => {
        released = true
        refreshButton.removeEventListener('click', refresh)
        pingButton.removeEventListener('click', ping)
      })
      ctx.onTick(() => { void refresh() })
      void refresh()
    },
  })
})(window)
