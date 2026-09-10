async function createUserAppResponse(rawUrl, store, buildDocument, policy) {
  const unavailable = () => new Response('Application unavailable', { status: 404 })
  try {
    if (typeof rawUrl !== 'string' || rawUrl.length > 512) return unavailable()
    const url = new URL(rawUrl)
    if (url.protocol !== 'odk-user-app:' || url.host !== 'app' || url.username || url.password) return unavailable()
    const match = /^\/([a-z][a-z0-9-]{0,63})\/([a-f0-9]{32})$/.exec(url.pathname)
    if (!match) return unavailable()
    const [, id, revision] = match
    const token = url.searchParams.get('token') || ''
    if (!/^[a-zA-Z0-9-]{0,128}$/.test(token)) return unavailable()
    const result = await store.getContent(id)
    if (!result.ok || result.app.revision !== revision) return unavailable()
    return new Response(buildDocument({ manifest: result.app, html: result.html, revision }, { token }), {
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
