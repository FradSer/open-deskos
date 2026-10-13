;(function (root) {
  'use strict'
  const GLYPHS = {"message": "<svg data-tabler=\"message\" aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1\" /></svg>", "leaf": "<svg data-tabler=\"leaf\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" aria-hidden=\"true\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M5 21c.5 -4.5 2.5 -8 7 -10\" /><path d=\"M9 18c6.218 0 10.5 -3.288 11 -12v-2h-4.014c-9 0 -11.986 4 -12 9c0 1 0 3 2 5h3l.014 0\" /></svg>", "terminal": "<svg data-tabler=\"terminal-2\" aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M8 9l3 3l-3 3\" /><path d=\"M13 15l3 0\" /><path d=\"M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12\" /></svg>"}
  function glyph(key) { return Object.hasOwn(GLYPHS, key) ? GLYPHS[key] : GLYPHS.message }
  root.odkPlugins.register({
    id: 'odk.page.personal-agent', manifest: { schemaVersion: 1 }, kind: 'page', surface: 'app',
    mount(el, ctx) {
      el.innerHTML = `<div class="agent-panel">
        <header class="agent-head"><span class="agent-avatar"></span><h1 class="agent-name"></h1>
          <details class="agent-identity" hidden><summary aria-label="Edit Agent identity"><svg data-tabler="edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1" /><path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415" /><path d="M16 5l3 3" /></svg></summary><form class="agent-identity-form">
            <label>Name<input name="name" maxlength="40" required /></label>
            <label>Icon<select name="icon"><option value="message">Message</option><option value="leaf">Leaf</option><option value="terminal">Terminal</option></select></label>
            <button type="submit">Save</button></form></details></header>
        <div class="agent-conversation" tabindex="0" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text"><p class="agent-empty">Ask about your desk or continue a task.</p></div>
        <button class="agent-latest" type="button" hidden>Jump to latest <svg data-tabler="arrow-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 5l0 14" /><path d="M18 13l-6 6" /><path d="M6 13l6 6" /></svg></button>
        <p class="agent-state" role="status">Checking Personal Bot…</p>
        <form class="agent-composer"><span class="agent-input-avatar"></span><textarea rows="1" maxlength="3000" aria-label="Message Personal Agent"></textarea>
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
      let lastStatus = 'unknown'
      let pending = false
      function applyIdentity() {
        $('.agent-name').textContent = identity.name
        for (const node of el.querySelectorAll('.agent-avatar, .agent-input-avatar')) node.innerHTML = glyph(identity.icon)
        for (const node of el.querySelectorAll('.agent-message-assistant')) node.setAttribute('aria-label', identity.name)
        root.odkIcons?.apply?.(el)
        input.placeholder = 'Message…'
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
      function render(status) {
        if (released || ctx.signal?.aborted || !status?.state) return
        revision++
        const bottom = conversation.scrollHeight - conversation.clientHeight - conversation.scrollTop < 40
        const busy = ['starting', 'sending', 'recording', 'transcribing', 'thinking'].includes(status.state)
        const newTurn = status.transcript && (!turn || status.transcript !== turn.prompt || (turn.completed && status.state === 'thinking'))
        if (newTurn) turn = { prompt: status.transcript, user: message('user', status.transcript), response: message('assistant', '') }
        if (status.message && ['thinking', 'idle', 'error'].includes(status.state)) {
          if (!turn) turn = { prompt: '', response: message('assistant', '') }
          root.odkPersonalBotReply.render(turn.response, status.message)
        }
        if (turn) {
          turn.response.setAttribute('aria-busy', String(status.state === 'thinking'))
          if (['idle', 'error'].includes(status.state)) turn.completed = true
        }
        const labels = { idle: 'Ready', thinking: 'Working…', recording: 'Listening…', starting: 'Preparing microphone…', sending: 'Submitting…', transcribing: 'Transcribing…', unavailable: 'Personal Bot unavailable', error: 'Request failed. You can try again.' }
        state.textContent = status.proposalError || labels[status.state] || 'Personal Bot status unknown'
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
        try { localStorage.setItem('odk.agent.identity', JSON.stringify(identity)) } catch { state.textContent = 'Identity changed for this window. Storage unavailable.' }
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
          if (revision === submittedRevision) state.textContent = 'Submitted. Waiting for the resident session…'
        } catch {
          if (!released) state.textContent = 'Message delivery was not confirmed. Draft kept; check the service before sending again.'
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
