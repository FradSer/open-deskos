;(function (root) {
  'use strict'
  root.odkPlugins.register({
    id: 'odk.app.devices', manifest: { schemaVersion: 1 }, kind: 'app', appId: 'devices',
    app: 'Devices', name: 'Devices', appKind: 'ui', source: 'builtin', capabilities: [],
    css: 'plugins/devices.css',
    mount(el, ctx) {
      el.innerHTML = '<section class="runtime-app reading-app"><h2>Devices</h2><p class="reading-status" role="status" aria-live="polite">Checking Bridge…</p><dl class="reading-values" data-gateway></dl><p class="reading-status" data-remote-status role="status" aria-live="polite">Checking S3…</p><dl class="reading-values" data-peers></dl><div class="reading-head"><button type="button" class="button-pill button-secondary" data-refresh>Refresh</button><button type="button" class="button-pill button-secondary" data-ping disabled>Check gateway</button></div><p class="app-detail" data-result role="status" aria-live="polite"></p>' +
        '<section class="devices-section" aria-labelledby="devices-hydra-title"><h3 id="devices-hydra-title">Hydra</h3><p class="reading-status" data-hydra-status role="status" aria-live="polite">Checking Hydra…</p><dl class="reading-values" data-hydra-values></dl><label class="devices-peer-field">Paired controller<select data-hydra-peer aria-label="Hydra controller"><option value="">Select a paired controller</option></select></label><div class="reading-head devices-actions"><button type="button" class="button-pill button-secondary" data-hydra-bind disabled>Use for Hydra</button><button type="button" class="button-pill button-secondary" data-hydra-unbind disabled>Remove association</button></div><p class="app-detail" data-hydra-result role="status" aria-live="polite"></p><dl class="reading-values" data-hydra-nodes></dl>' +
        '<section class="devices-control" aria-labelledby="hydra-control-title"><h4 id="hydra-control-title">Watering</h4><p class="reading-status" data-control-status role="status" aria-live="polite">Checking control availability…</p><fieldset data-control-fields disabled><legend class="sr-only">Hydra watering controls</legend><label class="devices-peer-field">Plant<select data-control-node>' +
        [1, 2, 3, 4, 5, 6].map(id => `<option value="${id}">Plant ${id}</option>`).join('') +
        '</select></label><label class="devices-peer-field">Duration in seconds<input data-control-duration type="number" min="1" max="30" step="1" value="5" inputmode="numeric"></label><div class="reading-head devices-actions"><button class="button-pill button-secondary" type="button" data-review-water>Review watering</button><button class="button-pill button-secondary" type="button" data-review-stop>Review stop</button></div><p class="app-detail">Keep Devices open during desktop watering. Closing it releases desktop control. Physical controls remain independent.</p><details class="devices-plan"><summary>Four-hour plan</summary><p class="app-detail">Offsets start when the plant node installs the plan. Add up to four entries, in time order. An existing controller plan may refuse an update.</p><label class="devices-peer-field">Season<select data-control-season><option value="0">Spring</option><option value="1" selected>Summer</option><option value="2">Autumn</option><option value="3">Winter</option></select></label><div class="devices-plan-entries" data-plan-entries></div><div class="reading-head devices-actions"><button class="button-pill button-secondary" type="button" data-plan-add>Add entry</button><button class="button-pill button-secondary" type="button" data-review-plan>Review plan</button><button class="button-pill button-secondary" type="button" data-review-pause>Review routine pause</button></div><p class="app-detail">A routine pause sends an empty plan. Critical dry protection stays active.</p></details></fieldset><section class="devices-confirmation" data-control-confirmation hidden aria-labelledby="hydra-confirm-title"><h4 id="hydra-confirm-title">Confirm Hydra action</h4><p data-control-summary></p><p class="app-detail" data-control-expiry></p><div class="reading-head devices-actions"><button class="button-pill" type="button" data-control-confirm>Confirm</button><button class="button-pill button-secondary" type="button" data-control-cancel>Cancel</button></div></section><p class="app-detail" data-control-result role="status" aria-live="polite"></p><p class="app-detail" data-control-owner></p></section></section></section>'
      const status = el.querySelector('.reading-status')
      const values = el.querySelector('[data-gateway]')
      const peers = el.querySelector('[data-peers]')
      const remoteStatus = el.querySelector('[data-remote-status]')
      const refreshButton = el.querySelector('[data-refresh]')
      const pingButton = el.querySelector('[data-ping]')
      const result = el.querySelector('[data-result]')
      const hydraStatus = el.querySelector('[data-hydra-status]')
      const hydraValues = el.querySelector('[data-hydra-values]')
      const hydraNodes = el.querySelector('[data-hydra-nodes]')
      const hydraPeer = el.querySelector('[data-hydra-peer]')
      const hydraBind = el.querySelector('[data-hydra-bind]')
      const hydraUnbind = el.querySelector('[data-hydra-unbind]')
      const hydraResult = el.querySelector('[data-hydra-result]')
      const controlStatus = el.querySelector('[data-control-status]')
      const controlFields = el.querySelector('[data-control-fields]')
      const controlNode = el.querySelector('[data-control-node]')
      const controlDuration = el.querySelector('[data-control-duration]')
      const controlSeason = el.querySelector('[data-control-season]')
      const planEntries = el.querySelector('[data-plan-entries]')
      const planAdd = el.querySelector('[data-plan-add]')
      const confirmation = el.querySelector('[data-control-confirmation]')
      const controlSummary = el.querySelector('[data-control-summary]')
      const controlExpiry = el.querySelector('[data-control-expiry]')
      const confirmButton = el.querySelector('[data-control-confirm]')
      const controlResult = el.querySelector('[data-control-result]')
      const controlOwner = el.querySelector('[data-control-owner]')
      const reviewPlan = el.querySelector('[data-review-plan]')
      const reviewPause = el.querySelector('[data-review-pause]')
      let released = false; let pending = false; let acting = false; let live = false
      let hydraPending = false; let hydraActing = false; let hydraGeneration = 0
      let hydraBoundPeer = null; let hydraPeerList = ''
      let controlAvailable = false; let controlBusy = false; let prepared = null; let controlEpoch = 0
      let planAvailable = false
      const controlListeners = []
      const visible = () => !released && document.visibilityState !== 'hidden'
      const controlRequest = request => root.odkPlatform?.hydraDeviceAction?.(request)
      function listenControl(selector, callback) {
        const target = el.querySelector(selector); target.addEventListener('click', callback)
        controlListeners.push(() => target.removeEventListener('click', callback))
      }
      function clearConfirmation() { prepared = null; confirmation.hidden = true }
      function updateControlFields() {
        controlFields.disabled = !controlAvailable || hydraActing || controlBusy || !!prepared || !visible()
        confirmButton.disabled = !controlAvailable || hydraActing || controlBusy || !prepared || !visible()
        reviewPlan.disabled = !planAvailable; reviewPause.disabled = !planAvailable
      }
      function formatSummary(summary) {
        if (summary?.action === 'water') return `Water Plant ${summary.node} for ${summary.durationMs / 1000} seconds.`
        if (summary?.action === 'stop') return `Release desktop watering for Plant ${summary.node}. Physical watering is independent.`
        const entries = summary?.entries || []
        return entries.length ? `Replace Plant ${summary.node}'s four-hour plan: ` + entries.map(entry => `${entry.offsetMinutes} min · ${({ 2: 'Top up', 3: 'Standard', 4: 'Deep soak' })[entry.intent]}${entry.night ? ' · Night label' : ''}`).join('; ') + '.' : `Pause routine watering for Plant ${summary.node}. Critical dry protection stays active.`
      }
      function renderControl(control) {
        if (control?.available !== true && (controlAvailable || prepared || controlBusy)) {
          ++controlEpoch; controlBusy = false; clearConfirmation()
          void Promise.resolve(controlRequest({ type: 'cancel' })).catch(() => {})
        }
        controlAvailable = control?.available === true
        planAvailable = control?.planSequence?.available === true
        controlStatus.textContent = ({ 'key-unavailable': 'Remote control is not configured. Telemetry remains available.', 'devices-inactive': 'Open Devices to use remote control.', 'hydra-unavailable': 'Remote control unavailable. Check Hydra and the gateway.', unavailable: 'Remote control unavailable.' })[control?.reason] || (controlAvailable ? 'Review each action before sending it to Hydra.' : 'Remote control unavailable.')
        if (!controlAvailable || prepared && (!control?.pending || control.pending.token !== prepared.token)) clearConfirmation()
        if (prepared) {
          const seconds = Math.ceil(control.pending.expiresInMs / 1000)
          controlExpiry.textContent = `Confirmation expires in ${seconds} seconds.`
          if (seconds <= 0) clearConfirmation()
        }
        if (control?.result) {
          const messages = { 'awaiting-ack': 'Waiting for the controller acknowledgement.', 'accepted-main': 'Controller accepted the action. Plant execution is not confirmed.', 'leaf-installed': 'Plant node acknowledged plan installation. Watering execution is not confirmed.', 'leaf-rejected': 'Plant node rejected the plan.', unknown: 'Outcome unknown. The action will not be sent again automatically.' }
          controlResult.textContent = messages[control.result.state] || 'Action state unavailable.'
        }
        controlOwner.textContent = control?.lease?.active ? `Host watering contact: ${Math.ceil(control.lease.remainingMs / 1000)} seconds remaining. Pump operation is not confirmed.` : control?.physicalOwner === true ? 'The last controller acknowledgement reported an independent physical watering owner.' : ''
        updateControlFields()
      }
      function addPlanEntry() {
        if (planEntries.children.length >= 4) return
        const item = document.createElement('div'); item.className = 'devices-plan-entry'
        item.innerHTML = '<label class="devices-peer-field">After minutes<input data-plan-minute type="number" min="0" max="239" step="1" value="0" inputmode="numeric"></label><label class="devices-peer-field">Watering intent<select data-plan-intent><option value="2">Top up</option><option value="3" selected>Standard</option><option value="4">Deep soak</option></select></label><label class="devices-peer-field">Day/night label<select data-plan-night><option value="0">Day</option><option value="1">Night</option></select></label><button type="button" class="button-pill button-secondary" data-plan-remove>Remove entry</button>'
        item.querySelector('[data-plan-minute]').value = String(planEntries.children.length * 60)
        item.querySelector('[data-plan-remove]').addEventListener('click', () => { item.remove(); planAdd.disabled = false })
        planEntries.append(item); planAdd.disabled = planEntries.children.length >= 4
      }
      async function prepareControl(action) {
        if (hydraActing || controlBusy || prepared || !controlAvailable || !visible()) return
        controlBusy = true; let epoch = ++controlEpoch; updateControlFields()
        controlResult.textContent = 'Checking the controller before confirmation…'
        try {
          const reply = await controlRequest(action)
          if (released || epoch !== controlEpoch || !controlAvailable || hydraActing || !visible()) return
          if (reply?.ok && typeof reply.token === 'string') {
            epoch = ++controlEpoch
            prepared = { token: reply.token }; confirmation.hidden = false
            controlSummary.textContent = formatSummary(reply.summary)
            controlExpiry.textContent = 'Confirm within 30 seconds.'; controlResult.textContent = ''
            confirmButton.focus()
          } else controlResult.textContent = 'Action could not be prepared. Check the connection and control configuration.'
        } catch { if (!released && epoch === controlEpoch) controlResult.textContent = 'Action preparation unavailable.' }
        finally { if (epoch === controlEpoch) controlBusy = false; if (!released) updateControlFields() }
      }
      async function confirmControl() {
        if (!prepared || hydraActing || !controlAvailable || controlBusy || !visible()) return
        const token = prepared.token; clearConfirmation(); controlBusy = true; updateControlFields()
        const epoch = ++controlEpoch; controlResult.textContent = 'Sending the confirmed action…'
        try {
          const reply = await controlRequest({ type: 'confirm', token })
          if (!released && epoch === controlEpoch) controlResult.textContent = reply?.ok ? 'Waiting for the controller acknowledgement.' : 'Action was not confirmed. Review a new action to try again.'
        } catch { if (!released && epoch === controlEpoch) controlResult.textContent = 'Outcome unknown. The action will not be sent again automatically.' }
        finally { if (epoch === controlEpoch) controlBusy = false; if (!released) { updateControlFields(); void refreshHydra() } }
      }
      async function cancelControl() {
        const epoch = ++controlEpoch; clearConfirmation(); controlBusy = true; updateControlFields()
        controlResult.textContent = 'Cancelling desktop control…'
        try {
          const reply = await controlRequest({ type: 'cancel' })
          if (!released && epoch === controlEpoch) controlResult.textContent = reply?.ok ? 'Confirmation cancelled. Host released desktop contact. Pump stop is not confirmed.' : 'Cancellation unconfirmed. Pump stop is not confirmed.'
        } catch { if (!released && epoch === controlEpoch) controlResult.textContent = 'Cancellation unconfirmed. Pump stop is not confirmed.' }
        finally { if (epoch === controlEpoch) controlBusy = false; if (!released) updateControlFields() }
      }
      function presence() {
        if (!visible()) { ++controlEpoch; controlBusy = false; clearConfirmation(); updateControlFields() }
        void Promise.resolve(controlRequest({ type: 'control-visibility', visible: visible() })).catch(() => {})
      }
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
      function updateHydraControls() {
        hydraPeer.disabled = hydraActing
        hydraBind.disabled = hydraActing || !hydraPeer.value || hydraPeer.value === hydraBoundPeer
        hydraUnbind.disabled = hydraActing || !hydraBoundPeer
      }
      async function refreshHydra() {
        if (released || hydraPending || hydraActing) return
        const generation = hydraGeneration
        const controlGeneration = controlEpoch
        hydraPending = true
        try {
          const snapshot = await root.odkPlatform?.getHydraDevice?.()
          if (released || generation !== hydraGeneration) return
          hydraBoundPeer = typeof snapshot?.peer === 'string' ? snapshot.peer : null
          if (controlGeneration === controlEpoch) renderControl(snapshot?.control)
          hydraStatus.textContent = ({
            unconfigured: 'Select a paired Hydra controller.',
            unavailable: 'Hydra unavailable. Check the controller and gateway.',
            syncing: 'Waiting for Hydra telemetry.',
            live: 'Hydra connected through ESP-NOW.',
          })[snapshot?.status] || 'Hydra management unavailable.'
          hydraValues.replaceChildren(); hydraNodes.replaceChildren()
          if (hydraBoundPeer) row(hydraValues, 'Controller', hydraBoundPeer)
          if (snapshot?.firmware) row(hydraValues, 'Firmware', snapshot.firmware)
          if (typeof snapshot?.clockValid === 'boolean') row(hydraValues, 'Controller clock', snapshot.clockValid ? 'Available' : 'Not set')
          const candidates = (Array.isArray(snapshot?.availablePeers) ? snapshot.availablePeers : []).filter(peer => typeof peer === 'string').slice(0, 7)
          const signature = JSON.stringify(candidates)
          if (signature !== hydraPeerList) {
            hydraPeerList = signature
            const selected = hydraPeer.value
            hydraPeer.replaceChildren()
            const placeholder = document.createElement('option')
            placeholder.value = ''; placeholder.textContent = candidates.length ? 'Select a paired controller' : 'No paired controller available'
            hydraPeer.append(placeholder)
            for (const peer of candidates) {
              const option = document.createElement('option'); option.value = peer; option.textContent = peer; hydraPeer.append(option)
            }
            hydraPeer.value = candidates.includes(selected) ? selected : candidates.includes(hydraBoundPeer) ? hydraBoundPeer : ''
          }
          for (const node of (Array.isArray(snapshot?.nodes) ? snapshot.nodes : []).slice(0, 6)) {
            const soil = Number.isFinite(node.soilPercent) ? `${node.soilPercent}% soil` : 'Soil unavailable'
            const availability = node.online === false ? 'Offline' : node.online === true && node.stale === false ? 'Current' : 'Stale'
            row(hydraNodes, `Plant ${node.id}`, [soil, node.status, availability].filter(Boolean).join(' · '))
          }
        } catch {
          if (!released && generation === hydraGeneration) {
            hydraStatus.textContent = 'Hydra management unavailable.'
            hydraValues.replaceChildren(); hydraNodes.replaceChildren()
            hydraBoundPeer = null
            if (controlGeneration === controlEpoch) renderControl(null)
            hydraPeerList = ''
            hydraPeer.replaceChildren()
            const option = document.createElement('option'); option.value = ''; option.textContent = 'Hydra management unavailable'; hydraPeer.append(option)
          }
        } finally {
          hydraPending = false
          if (!released) updateHydraControls()
        }
      }
      async function manageHydra(type) {
        if (released || hydraActing || (type === 'bind' && !hydraPeer.value) || (type === 'unbind' && !hydraBoundPeer)) return
        hydraActing = true; hydraGeneration++; updateHydraControls()
        cancelControl()
        hydraResult.textContent = 'Saving Hydra association…'
        try {
          const reply = await root.odkPlatform.hydraDeviceAction(type === 'bind' ? { type, peer: hydraPeer.value } : { type })
          if (!released) hydraResult.textContent = reply?.ok
            ? type === 'bind' ? 'Hydra association saved.' : 'Hydra association removed.'
            : 'Association could not be saved. Refresh and try again.'
        } catch { if (!released) hydraResult.textContent = 'Hydra management unavailable. Refresh to try again.' }
        finally {
          hydraActing = false
          if (!released) { updateHydraControls(); void refreshHydra() }
        }
      }
      const bindHydra = () => { void manageHydra('bind') }
      const unbindHydra = () => { void manageHydra('unbind') }
      const refreshAll = () => { void refresh(); void refreshHydra() }
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
      refreshButton.addEventListener('click', refreshAll)
      pingButton.addEventListener('click', ping)
      hydraPeer.addEventListener('change', updateHydraControls)
      hydraBind.addEventListener('click', bindHydra)
      hydraUnbind.addEventListener('click', unbindHydra)
      listenControl('[data-review-water]', () => {
        const seconds = Number(controlDuration.value)
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30) { controlResult.textContent = 'Choose a duration from 1 to 30 whole seconds.'; return }
        void prepareControl({ type: 'prepare-water', node: Number(controlNode.value), durationMs: seconds * 1000 })
      })
      listenControl('[data-review-stop]', () => { void prepareControl({ type: 'prepare-stop', node: Number(controlNode.value) }) })
      const preparePlan = pause => {
        const entries = pause ? [] : Array.from(planEntries.children, item => ({ offsetMinutes: Number(item.querySelector('[data-plan-minute]').value), intent: Number(item.querySelector('[data-plan-intent]').value), night: item.querySelector('[data-plan-night]').value === '1' }))
        if (!pause && (!entries.length || entries.some((entry, index) => !Number.isInteger(entry.offsetMinutes) || entry.offsetMinutes < 0 || entry.offsetMinutes > 239 || index > 0 && entry.offsetMinutes <= entries[index - 1].offsetMinutes))) { controlResult.textContent = 'Use one to four entries with increasing offsets from 0 to 239 minutes.'; return }
        void prepareControl({ type: 'prepare-plan', node: Number(controlNode.value), season: Number(controlSeason.value), entries })
      }
      listenControl('[data-review-plan]', () => preparePlan(false))
      listenControl('[data-review-pause]', () => preparePlan(true))
      listenControl('[data-plan-add]', addPlanEntry)
      listenControl('[data-control-confirm]', () => { void confirmControl() })
      listenControl('[data-control-cancel]', cancelControl)
      addPlanEntry()
      document.addEventListener('visibilitychange', presence)
      const presenceTimer = setInterval(presence, 500)
      presence()
      ctx.trackCleanup(() => {
        released = true
        ++controlEpoch; clearConfirmation(); clearInterval(presenceTimer)
        document.removeEventListener('visibilitychange', presence)
        controlListeners.forEach(remove => remove())
        void Promise.resolve(controlRequest({ type: 'control-visibility', visible: false })).catch(() => {})
        refreshButton.removeEventListener('click', refreshAll)
        pingButton.removeEventListener('click', ping)
        hydraPeer.removeEventListener('change', updateHydraControls)
        hydraBind.removeEventListener('click', bindHydra)
        hydraUnbind.removeEventListener('click', unbindHydra)
      })
      ctx.onTick(refreshAll)
      refreshAll()
    },
  })
})(window)
