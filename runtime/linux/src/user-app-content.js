'use strict'

// This policy applies only to responses from odk-user-app://. The shell document
// never receives user HTML, so its CSP remains unchanged.
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

// The handshake also keeps the package's appearance attribute current: the frame
// posts the theme it is rendering under, and nothing else in the package has to
// know how the Shell switches appearances.
function buildHandshake(token, theme, radius) {
  return `<script>/* Open DeskOS user-app readiness handshake */\n(()=>{const token=${escapeScriptValue(token)};const theme=${escapeScriptValue(theme)};const radius=${escapeScriptValue(tileRadius(radius) || '')};document.documentElement.dataset.theme=theme;let sent=false;const fail=(error)=>{if(sent)return;sent=true;try{parent.postMessage({type:'odk-user-app-error',token,error:String(error||'script error')},'*')}catch{}};window.addEventListener('error',event=>fail(event.message||'script error'),{once:true});window.addEventListener('unhandledrejection',event=>fail(event.reason||'unhandled rejection'),{once:true});window.addEventListener('message',event=>{const data=event.data;if(!data||data.token!==token||data.type!=='odk-user-app-theme')return;document.documentElement.dataset.theme=typeof data.theme==='string'?data.theme:theme;const measured=typeof data.radius==='string'&&/^\\d{1,3}(\\.\\d{1,2})?px$/.test(data.radius)?data.radius:radius;if(measured)document.documentElement.style.setProperty('--odk-radius-tile',measured)});const ready=()=>{if(sent)return;sent=true;try{parent.postMessage({type:'odk-user-app-ready',token},'*')}catch{}};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready()})()\n</script>`
}

function buildUserAppDocument(bundle, { token = '', theme = DEFAULT_THEME, radius } = {}) {
  const { html } = resolveBundle(bundle)
  const appearance = normalizeTheme(theme)
  const context = `<style id="odk-package-context">${buildContextStyle({ radius })}</style>`
  const handshake = buildHandshake(token, appearance, radius)
  const doctype = /^\s*<!doctype\s+html/i.test(html) ? '' : '<!doctype html>'
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return `${doctype}${html.replace(/<head(?:\s[^>]*)?>/i, (tag) => `${tag}${context}${handshake}`)}`
  }
  return `${doctype}<head>${context}${handshake}</head>${html}`
}

module.exports = { USER_APP_CSP, buildUserAppDocument }
