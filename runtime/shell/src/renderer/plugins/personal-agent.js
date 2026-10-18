;(function (root) {
  'use strict'
  const GLYPHS = {"message": "<svg data-tabler=\"message\" aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1\" /></svg>", "leaf": "<svg data-tabler=\"leaf\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" aria-hidden=\"true\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M5 21c.5 -4.5 2.5 -8 7 -10\" /><path d=\"M9 18c6.218 0 10.5 -3.288 11 -12v-2h-4.014c-9 0 -11.986 4 -12 9c0 1 0 3 2 5h3l.014 0\" /></svg>", "terminal": "<svg data-tabler=\"terminal-2\" aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M8 9l3 3l-3 3\" /><path d=\"M13 15l3 0\" /><path d=\"M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12\" /></svg>"}
  function glyph(key) { return Object.hasOwn(GLYPHS, key) ? GLYPHS[key] : GLYPHS.message }
  const CHILD_GLYPHS = {
    agent: GLYPHS.message, code: GLYPHS.terminal,
    book: '<svg data-tabler="book-open" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0" /><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0" /><path d="M3 6l0 13" /><path d="M12 6l0 13" /><path d="M21 6l0 13" /></svg>',
    compass: '<svg data-tabler="compass" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M8 16l2 -6l6 -2l-2 6l-6 2" /><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /><path d="M12 3l0 2" /><path d="M12 19l0 2" /><path d="M3 12l2 0" /><path d="M19 12l2 0" /></svg>',
    spark: '<svg data-tabler="sparkles" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6" /></svg>',
  }
  root.odkPlugins.register({
    id: 'odk.page.personal-agent', manifest: { schemaVersion: 1 }, kind: 'page', surface: 'app',
    mount(el, ctx) {
      el.innerHTML = `<div class="agent-panel">
        <header class="agent-head"><span class="agent-avatar" aria-hidden="true"></span>
          <details class="agent-identity"><summary aria-label="Edit Agent identity"><h1 class="agent-name"></h1><span class="agent-status-dot" aria-hidden="true"></span><span class="agent-state" role="status">Checking Personal Bot…</span><svg data-tabler="chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M6 9l6 6l6 -6" /></svg></summary><form class="agent-identity-form"><p class="agent-status-detail">Checking Personal Bot…</p>
            <label>Name<input name="name" maxlength="40" required /></label>
            <label>Icon<select name="icon"><option value="message">Message</option><option value="leaf">Leaf</option><option value="terminal">Terminal</option></select></label>
            <button type="submit">Save</button></form></details><p class="agent-jev-status" role="status">Checking Jev authentication…</p></header>
        <div class="agent-conversation" tabindex="0" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text"><p class="agent-empty">Ask about your desk or continue a task.</p></div>
        <button class="agent-latest" type="button" hidden>Jump to latest <svg data-tabler="arrow-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 5l0 14" /><path d="M18 13l-6 6" /><path d="M6 13l6 6" /></svg></button>
        <form class="agent-composer"><span class="agent-input-avatar" aria-hidden="true"></span><textarea rows="1" maxlength="3000" aria-label="Message Personal Agent"></textarea>
          <button class="agent-mic" type="button" aria-label="Record voice request"><svg data-tabler="microphone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M9 5a3 3 0 0 1 3 -3a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3a3 3 0 0 1 -3 -3l0 -5" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M8 21l8 0" /><path d="M12 17l0 4" /></svg></button><button class="agent-send" type="submit" aria-label="Send message"><svg data-tabler="arrow-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 5l0 14" /><path d="M18 11l-6 -6" /><path d="M6 11l6 -6" /></svg></button></form>
      </div>`
      const $ = selector => el.querySelector(selector)
      const conversation = $('.agent-conversation')
      const input = $('textarea')
      const state = $('.agent-state')
      let identity = { name: 'Personal Agent', icon: 'message' }
      try { const saved = JSON.parse(localStorage.getItem('odk.agent.identity')); if (typeof saved?.name === 'string' && saved.name.trim() && Object.hasOwn(GLYPHS, saved.icon)) identity = { name: saved.name.slice(0, 40), icon: saved.icon } } catch {}
      let released = false
      let revision = 0
      let turn = null
      const seenNotifications = new Set()
      const remoteMessages = new Map()
      let earlierUpdates
      let remoteCoverage
      const children = new Map()
      let lastStatus = 'unknown'
      let pending = false
      function setState(message, caption = message) {
        if (state.textContent !== caption) state.textContent = caption
        if ($('.agent-status-detail').textContent !== message) $('.agent-status-detail').textContent = message
        $('.agent-identity summary').setAttribute('aria-label', `${identity.name}, ${caption}. View status and edit identity`)
      }
      function applyIdentity() {
        $('.agent-name').textContent = identity.name
        $('.agent-identity summary').setAttribute('aria-label', `${identity.name}, ${state.textContent}. View status and edit identity`)
        for (const node of el.querySelectorAll('.agent-avatar, .agent-input-avatar')) node.innerHTML = glyph(identity.icon)
        for (const node of el.querySelectorAll('.agent-message-assistant')) node.setAttribute('aria-label', identity.name)
        root.odkIcons?.apply?.(el)
        input.placeholder = `Ask ${identity.name}…`
        input.setAttribute('aria-label', `Message ${identity.name}`)
        $('.agent-identity-form [name="name"]').value = identity.name
        $('.agent-identity-form [name="icon"]').value = identity.icon
      }
      applyIdentity()
      function latest() { conversation.scrollTop = conversation.scrollHeight; $('.agent-latest').hidden = true }
      function message(role, text) {
        $('.agent-empty')?.remove()
        const article = document.createElement('article')
        article.className = `agent-message agent-message-${role}`
        if (role === 'assistant') {
          article.innerHTML = '<div class="agent-message-bubble"><div class="agent-message-body"></div></div>'
          article.setAttribute('aria-label', identity.name)
        } else article.innerHTML = '<div class="agent-message-body"></div>'
        const body = article.querySelector('.agent-message-body')
        body.textContent = text
        conversation.append(article)
        root.odkIcons?.apply?.(article)
        return body
      }
      function renderAgents(frame) {
        if (frame?.state !== 'live' || !Array.isArray(frame.tasks)) {
          for (const row of children.values()) row.querySelector('.agent-child-state').textContent = 'Status unavailable'
          return
        }
        const active = new Set()
        for (const task of frame.tasks) {
          active.add(task.taskId)
          let row = children.get(task.taskId)
          if (!row) {
            $('.agent-empty')?.remove()
            row = document.createElement('article')
            row.className = 'agent-child'
            row.innerHTML = '<span class="agent-child-avatar" aria-hidden="true"></span><div class="agent-child-details"><span class="agent-child-name"></span><span class="agent-child-state"></span></div>'
            children.set(task.taskId, row)
            conversation.append(row)
          }
          const avatar = Object.hasOwn(CHILD_GLYPHS, task.identity?.avatar) ? task.identity.avatar : 'agent'
          if (row.dataset.avatar !== avatar) { row.dataset.avatar = avatar; row.querySelector('.agent-child-avatar').innerHTML = CHILD_GLYPHS[avatar]; root.odkIcons?.apply?.(row) }
          row.querySelector('.agent-child-name').textContent = task.identity?.name || 'Temporary agent'
          row.querySelector('.agent-child-state').textContent = { starting: 'Starting', running: 'Running', cancelling: 'Cancelling' }[task.state] || 'Status unavailable'
        }
        for (const [id, row] of children) if (!active.has(id)) { row.remove(); children.delete(id) }
      }
      function renderRemote(frame) {
        if (!frame || frame.state === 'disabled') return
        for (const item of [...(frame.messages ?? [])].reverse()) {
          if (remoteMessages.has(item.id)) continue
          const body = message('assistant', item.text)
          const article = body.closest('article')
          article.dataset.remoteId = item.id
          remoteMessages.set(item.id, article)
          if (item.presentation === 'assistant_update') article.classList.add('agent-update')
          else {
            if (!earlierUpdates) {
              earlierUpdates = document.createElement('details')
              earlierUpdates.className = 'agent-earlier-updates'
              const label = document.createElement('summary')
              label.textContent = 'Earlier task updates'
              earlierUpdates.append(label)
              conversation.insertBefore(earlierUpdates, article)
            }
            earlierUpdates.append(article)
          }
          while (remoteMessages.size > 64) {
            const first = remoteMessages.keys().next().value
            remoteMessages.get(first)?.remove(); remoteMessages.delete(first)
          }
          const details = document.createElement('details')
          details.className = 'agent-update-sources'
          const title = document.createElement('summary')
          title.textContent = 'Sources'
          details.append(title)
          const scope = document.createElement('p')
          scope.textContent = 'Reported by connected agents. Execution is not independently verified.'
          details.append(scope)
          for (const source of item.sources ?? []) {
            const line = document.createElement('p')
            line.textContent = `${source.machine} · ${source.sessionId} · ${source.project} · ${source.control === 'configured' ? 'Configured control target' : 'Report only'} · ${source.availability} · bounded history`
            const reference = document.createElement('p')
            reference.textContent = `Source: ${source.key || 'Unavailable'}\nRevision: ${source.revision || 'Unavailable'}`
            details.append(line, reference)
          }
          if (item.omittedSources) {
            const note = document.createElement('p')
            note.textContent = `${item.omittedSources} source references omitted. Ask for remote Pi updates to inspect them.`
            details.append(note)
          }
          body.append(details)
        }
        if (!remoteCoverage) {
          remoteCoverage = document.createElement('section')
          remoteCoverage.className = 'agent-remote-coverage'
          remoteCoverage.innerHTML = '<p role="status"></p><details><summary>Details</summary><p></p></details>'
          conversation.append(remoteCoverage)
        }
        const historyOmitted = Math.max(0, (frame.total || 0) - (frame.messages?.length || 0))
        const complete = !historyOmitted && !frame.expiredMessages && frame.state === 'live' && !frame.hasMore && !frame.omitted && !frame.heldCount
        remoteCoverage.hidden = complete
        remoteCoverage.querySelector('[role="status"]').textContent = frame.state === 'unavailable'
          ? 'I cannot reach the other agents right now.' : frame.state === 'stale'
            ? 'These task updates may be out of date.' : frame.heldCount
              ? 'Some task updates still need review.' : frame.hasMore
                ? 'More task updates are available. Ask to see them.' : historyOmitted > 0
                  ? 'Earlier task updates are available. Ask to see them.' : frame.expiredMessages
                    ? 'Some earlier task updates have expired.' : 'Some task updates are not available yet.'
        remoteCoverage.querySelector('details p').textContent = `Remote state: ${frame.state}. ${frame.omitted || 0} sources remain in bounded pages; ${frame.heldCount || 0} revisions require review; ${historyOmitted} earlier summaries remain in history; ${frame.expiredMessages || 0} superseded summaries expired.`
      }
      function renderJev(value) {
        const states = {
          checking: ['Checking Jev authentication…', 'Checking Jev…'],
          verified: ['Jev authentication verified.', 'Ready'],
          missing_credential: ['Jev credentials are missing. Add them in the service configuration, then restart the Personal Agent service.', 'Jev not configured'],
          auth_rejected: ['Jev authentication was rejected. Check the service credentials, then restart the Personal Agent service.', 'Jev authentication rejected'],
          unavailable: ['Jev authentication could not be checked. Check network and service settings, then restart the Personal Agent service.', 'Jev unavailable'],
        }
        const [text, caption] = value && Object.hasOwn(states, value.status)
          ? states[value.status] : ['Jev authentication has not been checked.', 'Jev not checked']
        const node = $('.agent-jev-status')
        if (node.textContent !== text) node.textContent = text
        return caption
      }
      function render(status) {
        if (released || ctx.signal?.aborted || !status?.state) return
        revision++
        const bottom = conversation.scrollHeight - conversation.clientHeight - conversation.scrollTop < 40
        const jevCaption = renderJev(status.jev)
        renderAgents(status.agents)
        renderRemote(status.remote)
        const busy = ['starting', 'sending', 'recording', 'transcribing', 'thinking'].includes(status.state)
        const newTurn = status.transcript && (!turn || status.transcript !== turn.prompt || (turn.completed && status.state === 'thinking'))
        if (newTurn) turn = { prompt: status.transcript, user: message('user', status.transcript), response: message('assistant', '') }
        const reply = status.message
        if (reply && ['thinking', 'idle', 'error'].includes(status.state)) {
          if (!turn) turn = { prompt: '', response: message('assistant', '') }
          root.odkPersonalBotReply.render(turn.response, reply)
        }
        for (const notification of Array.isArray(status.notifications) ? status.notifications : []) {
          if (!notification || typeof notification.id !== 'string' || !notification.id || typeof notification.message !== 'string' || !notification.message || seenNotifications.has(notification.id)) continue
          seenNotifications.add(notification.id)
          message('assistant', notification.message)
        }
        if (turn) {
          turn.response.setAttribute('aria-busy', String(status.state === 'thinking'))
          if (['idle', 'error'].includes(status.state)) turn.completed = true
        }
        const labels = { idle: 'Ready', thinking: 'Working…', recording: 'Listening…', starting: 'Preparing microphone…', sending: 'Submitting…', transcribing: 'Transcribing…', unavailable: 'Personal Bot unavailable', error: 'Request failed. You can try again.' }
        const caption = status.state === 'idle' ? jevCaption : labels[status.state] || 'Personal Bot status unknown'
        setState(status.proposalError || caption, status.proposalError ? 'Suggestions unavailable' : caption)
        $('.agent-send').disabled = busy || status.state === 'unavailable' || pending
        $('.agent-mic').disabled = busy && status.state !== 'recording'
        $('.agent-mic').setAttribute('aria-label', status.state === 'recording' ? 'Stop recording' : 'Record voice request')
        $('.agent-mic').dataset.recording = String(status.state === 'recording')
        lastStatus = status.state
        if (bottom) latest()
        else $('.agent-latest').hidden = false
      }
      const unsub = root.odkPersonalBot?.subscribe(render)
      ctx.trackCleanup?.(() => { released = true; unsub?.() })
      const initialRevision = revision
      root.odkPersonalBot?.getStatus().then(status => { if (revision === initialRevision) render(status) }).catch(() => { if (revision === initialRevision) render({ state: 'unavailable' }) })
      $('.agent-identity-form').addEventListener('submit', event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const name = String(form.get('name')).trim()
        const icon = String(form.get('icon'))
        if (!name || !Object.hasOwn(GLYPHS, icon)) return
        identity = { name: name.slice(0, 40), icon }
        try { localStorage.setItem('odk.agent.identity', JSON.stringify(identity)) } catch { setState('Identity changed for this window. Storage unavailable.', 'Identity changed for this window') }
        applyIdentity()
        $('.agent-identity').open = false
        input.focus()
      })
      $('.agent-composer').addEventListener('submit', async event => {
        event.preventDefault()
        const text = input.value.trim()
        if (!text || pending || $('.agent-send').disabled) return
        pending = true
        $('.agent-send').disabled = true
        const submittedRevision = revision
        try {
          const receipt = await root.odkPersonalBot.sendText(text)
          if (released) return
          if (!receipt?.accepted) throw Error('refused')
          if (input.value.trim() === text) input.value = ''
          if (revision === submittedRevision) setState('Submitted. Waiting for the resident session…', 'Waiting for response…')
        } catch {
          if (!released) setState('Message delivery was not confirmed. Draft kept; check the service before sending again.', 'Delivery not confirmed')
        } finally {
          pending = false
          if (!released) $('.agent-send').disabled = !['idle', 'error'].includes(lastStatus)
        }
      })
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('.agent-composer').requestSubmit() }
      })
      $('.agent-mic').addEventListener('click', () => root.odkPersonalBotStatus?.mic())
      $('.agent-latest').addEventListener('click', latest)
      conversation.addEventListener('scroll', () => { $('.agent-latest').hidden = conversation.scrollHeight - conversation.clientHeight - conversation.scrollTop < 40 })
    },
  })
})(window)
