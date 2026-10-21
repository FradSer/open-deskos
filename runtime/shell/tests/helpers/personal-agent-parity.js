'use strict'

/**
 * One assertion script answers for both Shell Hosts.
 *
 * The Android host renders the same document as Electron, so the same check
 * guards both: a renderer change that breaks the phone fails here for the same
 * reason it would fail on the desk. The script reads public renderer surfaces
 * only, and returns one JSON object per state.
 */

const VIEWPORTS = {
  // 720x1280 at 240 dpi: the redroid fidelity target.
  redroid: { width: 480, height: 853 },
  // 720x1280 at 320 dpi: the Sony install target, whose WebView cannot render
  // this design yet.
  sony: { width: 360, height: 640 },
}

/** Box edges may differ by rounding alone; a real layout difference is larger. */
const TOLERANCE_PX = 2

/** The fixture states every host must render the same way. */
const STATES = [
  'idle-empty',
  'recording',
  'transcribing',
  'thinking-streaming',
  'idle-reply',
  'agents-running',
  'remote-coverage',
  'error',
  'unavailable',
]

/** The theme both hosts are pinned to before a comparison. */
const PARITY_THEME = 'instrument'

function parityScript() {
  return `(() => {
    const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
    const visible = (node) => { if (!node) return false; const r = node.getBoundingClientRect(); const s = getComputedStyle(node); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
    const text = (node) => (node && node.textContent ? node.textContent : '').trim()
    const panel = document.querySelector('.agent-panel')
    const conversation = document.querySelector('.agent-conversation')
    const composer = document.querySelector('.agent-composer')
    const identity = document.querySelector('.agent-identity summary')
    const mic = document.querySelector('.agent-mic')
    const send = document.querySelector('.agent-send')
    const status = document.getElementById('personal-bot-status')
    const overflow = [...document.querySelectorAll('.agent-panel, .agent-panel *')]
      .filter(visible)
      .filter((node) => { const r = node.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1 })
      .map((node) => node.className || node.tagName)
    return JSON.stringify({
      viewport: { width: innerWidth, height: innerHeight },
      agentPanelPresent: !!document.querySelector('#personal-agent .agent-panel'),
      panel: box(panel),
      identity: {
        box: box(identity),
        label: (identity && identity.getAttribute('aria-label')) || '',
        name: text(document.querySelector('.agent-name')),
        state: text(document.querySelector('.agent-state')),
      },
      conversation: {
        box: box(conversation),
        // The platform's own scrollbar metric. A host that draws a classic
        // scrollbar reserves this gutter for a stable scrollbar, and a host with
        // overlay scrollbars reserves none, so message geometry is compared with
        // this gutter removed rather than as a raw box.
        gutter: conversation ? (conversation.offsetWidth - conversation.clientWidth) : 0,
        scrollHeight: conversation ? conversation.scrollHeight : 0,
        clientHeight: conversation ? conversation.clientHeight : 0,
      },
      empty: visible(document.querySelector('.agent-empty')) ? text(document.querySelector('.agent-empty')) : '',
      messages: (function () {
        // The platform scrollbar gutter changes the width a conversation can use,
        // so a message is compared where it sits inside that content box: which
        // edges it is flush with and how tall it is. The width of a content-sized
        // bubble is the same on both hosts; only a full-width bubble absorbs the
        // gutter, and its flush edges state that instead.
        const contentLeft = conversation ? conversation.getBoundingClientRect().left : 0
        const contentRight = conversation ? contentLeft + conversation.getBoundingClientRect().width - (conversation.offsetWidth - conversation.clientWidth) : 0
        // Content coordinates, so a scroll position a host reaches a frame later
        // does not read as a different layout.
        const contentTop = conversation ? conversation.getBoundingClientRect().top - conversation.scrollTop : 0
        return [...document.querySelectorAll('.agent-message')].map((node) => {
          const r = node.getBoundingClientRect()
          return {
            role: node.className.includes('agent-message-user') ? 'user' : 'assistant',
            text: text(node.querySelector('.agent-message-body')),
            box: box(node),
            relativeLeft: Math.round(r.left - contentLeft),
            relativeRight: Math.round(r.right - contentRight),
            relativeTop: Math.round(r.top - contentTop),
            busy: node.querySelector('[aria-busy]') ? node.querySelector('[aria-busy]').getAttribute('aria-busy') : '',
          }
        })
      })(),
      children: [...document.querySelectorAll('.agent-child')].map((node) => ({
        name: text(node.querySelector('.agent-child-name')),
        state: text(node.querySelector('.agent-child-state')),
      })),
      composer: {
        box: box(composer),
        mode: composer ? composer.dataset.mode || '' : '',
        placeholder: (document.querySelector('.agent-composer textarea') || {}).placeholder || '',
        insidePanel: !!panel && !!composer && composer.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom + 1,
      },
      voiceInput: !!(window.odkPersonalBot && window.odkPersonalBot.supportsVoiceInput !== false),
      controls: {
        mic: { box: box(mic), hidden: !!(mic && mic.hidden), disabled: !!(mic && mic.disabled), label: (mic && mic.getAttribute('aria-label')) || '' },
        send: { box: box(send), hidden: !!(send && send.hidden), disabled: !!(send && send.disabled) },
      },
      statusPanel: { visible: visible(status), box: box(status) },
      overflow,
      theme: document.documentElement.getAttribute('data-theme') || '',
    })
  })()`
}

/** Prepare one host for a comparison: same viewport, same theme, same state. */
function parityPrepareScript(theme = PARITY_THEME) {
  return `(async () => {
    if (window.odkTheme && window.odkTheme.set) await window.odkTheme.set('${theme}')
    window.dispatchEvent(new Event('resize'))
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return true
  })()`
}

function difference(label, a, b) {
  if (a === b) return null
  if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= TOLERANCE_PX) return null
  return { label, electron: a, android: b }
}

function compareBoxes(label, a, b) {
  const out = []
  if (!a || !b) return [difference(label, JSON.stringify(a), JSON.stringify(b))].filter(Boolean)
  for (const key of ['x', 'y', 'w', 'h']) out.push(difference(label + '.' + key, a[key], b[key]))
  return out.filter(Boolean)
}

/** Report every difference that matters; rounding alone is not one. */
function compareParity(electron, android) {
  const differences = []
  differences.push(difference('viewport.width', electron.viewport.width, android.viewport.width))
  differences.push(difference('viewport.height', electron.viewport.height, android.viewport.height))
  differences.push(difference('theme', electron.theme, android.theme))
  differences.push(difference('agentPanelPresent', electron.agentPanelPresent, android.agentPanelPresent))
  differences.push(...compareBoxes('panel', electron.panel, android.panel))
  differences.push(...compareBoxes('identity', electron.identity.box, android.identity.box))
  differences.push(difference('identity.name', electron.identity.name, android.identity.name))
  differences.push(difference('identity.state', electron.identity.state, android.identity.state))
  differences.push(difference('identity.label', electron.identity.label, android.identity.label))
  differences.push(...compareBoxes('composer', electron.composer.box, android.composer.box))
  differences.push(difference('composer.placeholder', electron.composer.placeholder, android.composer.placeholder))
  differences.push(difference('composer.insidePanel', electron.composer.insidePanel, android.composer.insidePanel))
  // A host that declares no voice input opens the keyboard by design, so those
  // two hosts assert the honest shape each one shows instead of comparing it.
  if (electron.voiceInput === android.voiceInput) {
    differences.push(difference('composer.mode', electron.composer.mode, android.composer.mode))
    differences.push(...compareBoxes('controls.mic', electron.controls.mic.box, android.controls.mic.box))
    differences.push(difference('controls.mic.disabled', electron.controls.mic.disabled, android.controls.mic.disabled))
    differences.push(difference('controls.mic.label', electron.controls.mic.label, android.controls.mic.label))
    differences.push(...compareBoxes('controls.send', electron.controls.send.box, android.controls.send.box))
    differences.push(difference('controls.send.disabled', electron.controls.send.disabled, android.controls.send.disabled))
  } else {
    const speaking = electron.voiceInput ? electron : android
    const silent = electron.voiceInput ? android : electron
    differences.push(difference('composer.mode.voiceHost', speaking.composer.mode, 'voice'))
    differences.push(difference('controls.mic.hidden.voiceHost', speaking.controls.mic.hidden, false))
    differences.push(difference('controls.mic.disabled.voiceHost', speaking.controls.mic.disabled, false))
    differences.push(difference('controls.mic.label.voiceHost', speaking.controls.mic.label.length > 0, true))
    differences.push(difference('controls.send.hidden.voiceHost', speaking.controls.send.hidden, true))
    differences.push(difference('composer.mode.silentHost', silent.composer.mode, 'keyboard'))
    differences.push(difference('controls.mic.hidden.silentHost', silent.controls.mic.hidden, false))
    differences.push(difference('controls.mic.disabled.silentHost', silent.controls.mic.disabled, true))
    differences.push(difference('controls.mic.label.silentHost', silent.controls.mic.label.length > 0, true))
    differences.push(difference('controls.send.hidden.silentHost', silent.controls.send.hidden, false))
    differences.push(difference('controls.send.disabled.silentHost', silent.controls.send.disabled, false))
  }
  differences.push(difference('empty', electron.empty, android.empty))
  differences.push(difference('messageCount', electron.messages.length, android.messages.length))
  const messageCount = Math.min(electron.messages.length, android.messages.length)
  for (let index = 0; index < messageCount; index += 1) {
    const one = electron.messages[index]
    const other = android.messages[index]
    differences.push(difference('messages[' + index + '].role', one.role, other.role))
    differences.push(difference('messages[' + index + '].text', one.text, other.text))
    // The flush edge is the design: an Agent reply starts at the conversation's
    // leading edge, and an owner turn ends at its trailing edge. The opposite
    // edge of a content-sized bubble sits where its own text puts it, so its width
    // is compared instead of a position the available width would move.
    differences.push(difference('messages[' + index + '].relativeRight', one.relativeRight, other.relativeRight))
    if (one.role === 'assistant') differences.push(difference('messages[' + index + '].relativeLeft', one.relativeLeft, other.relativeLeft))
    else differences.push(difference('messages[' + index + '].box.w', one.box?.w, other.box?.w))
    differences.push(difference('messages[' + index + '].box.h', one.box?.h, other.box?.h))
    differences.push(difference('messages[' + index + '].relativeTop', one.relativeTop, other.relativeTop))
  }
  differences.push(difference('childCount', electron.children.length, android.children.length))
  const childCount = Math.min(electron.children.length, android.children.length)
  for (let index = 0; index < childCount; index += 1) {
    differences.push(difference('children[' + index + '].name', electron.children[index].name, android.children[index].name))
    differences.push(difference('children[' + index + '].state', electron.children[index].state, android.children[index].state))
  }
  differences.push(difference('statusPanel.visible', electron.statusPanel.visible, android.statusPanel.visible))
  differences.push(difference('overflow', JSON.stringify(electron.overflow), JSON.stringify(android.overflow)))
  differences.push(difference('conversation.scrollable', electron.conversation.scrollHeight >= electron.conversation.clientHeight, android.conversation.scrollHeight >= android.conversation.clientHeight))
  return differences.filter(Boolean)
}

module.exports = { VIEWPORTS, TOLERANCE_PX, STATES, PARITY_THEME, parityScript, parityPrepareScript, compareParity }