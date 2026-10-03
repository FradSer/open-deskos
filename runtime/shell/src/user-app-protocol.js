const { fontResponse, DEFAULT_THEME, normalizeTheme } = require('./user-app-context')

/*
 * Serves installed package documents, and the appearance fonts they may use.
 *
 * The theme travels on the frame URL, so the document that is served already carries
 * the right token block and font faces. Font ids are an allowlist: a package can ask
 * for a face the appearance uses and nothing else, and never reaches outside the
 * release it is running in.
 */
async function createUserAppResponse(rawUrl, store, buildDocument, policy, { runtimeRoot } = {}) {
  const unavailable = () => new Response('Application unavailable', { status: 404 })
  try {
    if (typeof rawUrl !== 'string' || rawUrl.length > 512) return unavailable()
    const url = new URL(rawUrl)
    if (url.protocol !== 'odk-user-app:' || url.username || url.password) return unavailable()
    if (url.host !== 'app') return unavailable()
    const font = /^\/font\/([a-z0-9-]{1,32})$/.exec(url.pathname)
    if (font) return fontResponse(font[1], { runtimeRoot })
    const match = /^\/([a-z][a-z0-9-]{0,63})\/([a-f0-9]{32})$/.exec(url.pathname)
    if (!match) return unavailable()
    const [, id, revision] = match
    const token = url.searchParams.get('token') || ''
    if (!/^[a-zA-Z0-9-]{0,128}$/.test(token)) return unavailable()
    const theme = normalizeTheme(url.searchParams.get('theme') || DEFAULT_THEME)
    const radius = url.searchParams.get('radius') || undefined
    const result = await store.getContent(id)
    if (!result.ok || result.app.revision !== revision) return unavailable()
    return new Response(buildDocument({ manifest: result.app, html: result.html, revision }, { token, theme, radius }), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': policy,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return unavailable()
  }
}

module.exports = { createUserAppResponse }