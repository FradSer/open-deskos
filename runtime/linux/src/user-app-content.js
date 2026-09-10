'use strict'

// This policy applies only to responses from odk-user-app://. The shell document
// never receives user HTML, so its CSP remains unchanged.
const USER_APP_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "font-src data:",
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

function buildHandshake(token) {
  return `<script>/* Open DeskOS user-app readiness handshake */\n(()=>{const token=${escapeScriptValue(token)};let sent=false;const fail=(error)=>{if(sent)return;sent=true;try{parent.postMessage({type:'odk-user-app-error',token,error:String(error||'script error')},'*')}catch{}};window.addEventListener('error',event=>fail(event.message||'script error'),{once:true});window.addEventListener('unhandledrejection',event=>fail(event.reason||'unhandled rejection'),{once:true});const ready=()=>{if(sent)return;sent=true;try{parent.postMessage({type:'odk-user-app-ready',token},'*')}catch{}};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready()})()\n</script>`
}

function buildUserAppDocument(bundle, { token = '' } = {}) {
  const { html } = resolveBundle(bundle)
  const handshake = buildHandshake(token)
  const doctype = /^\s*<!doctype\s+html/i.test(html) ? '' : '<!doctype html>'
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return `${doctype}${html.replace(/<head(?:\s[^>]*)?>/i, (tag) => `${tag}${handshake}`)}`
  }
  return `${doctype}<head>${handshake}</head>${html}`
}

module.exports = { USER_APP_CSP, buildUserAppDocument }
