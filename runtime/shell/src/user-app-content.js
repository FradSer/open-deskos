'use strict'

// This policy applies only to responses from odk-user-app://. The shell document
// never receives user HTML, so its CSP remains unchanged.
const { bindPinch } = require('./renderer/core/home-handle')

const USER_APP_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  // Fonts come from this package's own inline data or from the Shell's own release
  // through the odk-user-app://font/<id> route, which is an allowlist of the faces
  // the appearance actually uses.
  'font-src data: odk-user-app:',
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self' file:",
].join('; ')

function escapeScriptValue(value) {
  return JSON.stringify(String(value ?? '')).replace(/</g, '\\u003c')
}

function resolveBundle(bundle) {
  if (typeof bundle === 'string') return { html: bundle }
  if (!bundle || typeof bundle.html !== 'string') throw new TypeError('user app bundle html is required')
  return bundle
}

const {
  DEFAULT_THEME,
  normalizeTheme,
  buildContextStyle,
  tileRadius,
} = require('./user-app-context')

// This API carries only a declared source name. The parent binds package identity
// and revision; package code cannot choose a URL, headers, or credentials.
function bindPackageApi(scope, token) {
  let sequence = 0
  const pending = new Map()
  const failure = error => ({ ok: false, state: 'unavailable', error })
  scope.addEventListener('message', event => {
    const data = event.data
    if (event.source !== scope.parent || data?.token !== token || data.type !== 'odk-user-app-api-result') return
    const request = pending.get(data.requestId)
    if (!request) return
    pending.delete(data.requestId); clearTimeout(request.timer); request.resolve(data.result)
  })
  scope.addEventListener('pagehide', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.resolve(failure('frame-closed')) }
    pending.clear()
  }, { once: true })
  scope.odkPackageApi = Object.freeze({ read(sourceId) {
    if (typeof sourceId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(sourceId) || pending.size >= 8) return Promise.resolve(failure('invalid-api-request'))
    return new Promise(resolve => {
      const requestId = ++sequence
      const timer = setTimeout(() => { pending.delete(requestId); resolve(failure('api-timeout')) }, 12000)
      pending.set(requestId, { timer, resolve })
      scope.parent.postMessage({ type: 'odk-user-app-api-read', token, requestId, sourceId }, '*')
    })
  } })
}

// The handshake also keeps the package's appearance attribute current: the frame
// posts the theme it is rendering under, and nothing else in the package has to
// know how the Shell switches appearances.
function bindPackageDevices(scope, token) {
  let sequence = 0, closed = false
  const pending = new Map()
  const failure = error => ({ ok: false, error })
  scope.addEventListener('message', event => {
    const data = event.data
    if (event.source !== scope.parent || data?.token !== token || data.type !== 'odk-user-app-device-result') return
    const request = pending.get(data.requestId)
    if (!request) return
    pending.delete(data.requestId); clearTimeout(request.timer); request.resolve(data.result)
  })
  scope.addEventListener('pagehide', () => {
    closed = true
    for (const request of pending.values()) { clearTimeout(request.timer); request.resolve(failure('frame-closed')) }
    pending.clear()
  }, { once: true })
  function request(value) {
    if (closed) return Promise.resolve(failure('frame-closed'))
    if (pending.size >= 8) return Promise.resolve(failure('device-busy'))
    return new Promise(resolve => {
      const requestId = ++sequence
      const timer = setTimeout(() => { pending.delete(requestId); resolve(failure(value.type === 'send' ? 'delivery-unknown' : 'device-timeout')) }, 6000)
      pending.set(requestId, { timer, resolve })
      try { scope.parent.postMessage({ type: 'odk-user-app-device', token, requestId, request: value }, '*') }
      catch { clearTimeout(timer); pending.delete(requestId); resolve(failure('device-unavailable')) }
    })
  }
  scope.odkPackageDevices = Object.freeze({ read: () => request({ type: 'read' }), send(peer, payload) {
    if (typeof peer !== 'string' || peer.length !== 17 || typeof payload !== 'string' || !payload.length || payload.length > 336) return Promise.resolve(failure('invalid-device-request'))
    return request({ type: 'send', peer, payload })
  } })
}

function buildHandshake(token, theme, radius) {
  return `<script>/* Open DeskOS user-app readiness handshake */\n(()=>{const token=${escapeScriptValue(token)},theme0=${escapeScriptValue(theme)},radius0=${escapeScriptValue(tileRadius(radius) || '')},scope=typeof window!=='undefined'?window:globalThis;document.documentElement.dataset.theme=theme0;let returnHome=false;const events=new AbortController();(${bindPinch.toString()})({root:scope,owns:target=>document.documentElement.contains(target),enabled:()=>returnHome,onReturn:()=>parent.postMessage({type:'odk-user-app-return-home',token},'*'),signal:events.signal});scope.addEventListener('pagehide',()=>events.abort(),{once:true});let sent=false;const fail=(error)=>{if(sent)return;sent=true;try{parent.postMessage({type:'odk-user-app-error',token,error:String(error||'script error')},'*')}catch{}};scope.addEventListener('error',event=>fail(event.message||'script error'),{once:true});scope.addEventListener('unhandledrejection',event=>fail(event.reason||'unhandled rejection'),{once:true});scope.addEventListener('message',event=>{const data=event.data;if(event.source!==parent||!data||data.token!==token||data.type!=='odk-user-app-theme')return;returnHome=data.returnHome===true;if(returnHome)document.documentElement.style.touchAction='pan-x pan-y';document.documentElement.dataset.theme=typeof data.theme==='string'?data.theme:theme0;const measured=typeof data.radius==='string'&&/^\\d{1,3}(\\.\\d{1,2})?px$/.test(data.radius)?data.radius:radius0;if(measured)document.documentElement.style.setProperty('--odk-radius-tile',measured)});/* Declared Data: a package publishes what its manifest declared, and the Shell decides what of that is a reading. The document only carries it, so publishing grants no capability the package did not already have. */(${bindPackageApi.toString()})(scope,token);(${bindPackageDevices.toString()})(scope,token);scope.odkPackageData=Object.freeze({publish:(data)=>{if(!data||typeof data!=='object'||Array.isArray(data))return false;try{parent.postMessage({type:'odk-user-app-data',token,data},'*');return true}catch{return false}}});const ready=()=>{if(sent)return;sent=true;try{parent.postMessage({type:'odk-user-app-ready',token},'*')}catch{}};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready()})()\n</script>`
}

function buildUserAppDocument(bundle, { token = '', theme = DEFAULT_THEME, radius, appearancePlugins } = {}) {
  const { html } = resolveBundle(bundle)
  const appearance = normalizeTheme(theme, { appearancePlugins })
  const context = `<style id="odk-package-context">${buildContextStyle({ radius, appearancePlugins })}</style>`
  const handshake = buildHandshake(token, appearance, radius)
  const doctype = /^\s*<!doctype\s+html/i.test(html) ? '' : '<!doctype html>'
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return `${doctype}${html.replace(/<head(?:\s[^>]*)?>/i, (tag) => `${tag}${context}${handshake}`)}`
  }
  return `${doctype}<head>${context}${handshake}</head>${html}`
}

module.exports = { USER_APP_CSP, buildUserAppDocument }
