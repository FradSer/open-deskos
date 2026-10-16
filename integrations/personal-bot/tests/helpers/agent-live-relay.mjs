import http from 'node:http'
import { once } from 'node:events'
import { randomBytes, timingSafeEqual } from 'node:crypto'

const ACCESS_HEADER = 'x-odk-live-relay-key'

function forwardedHeaders(headers) {
  const excluded = new Set([ACCESS_HEADER, 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
    ...String(headers.connection ?? '').split(',').map(value => value.trim().toLowerCase())])
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !excluded.has(key.toLowerCase())))
}

/** Optional loopback-only relay for one configured HTTP provider unreachable from the Docker VM. */
export async function openLiveHostRelay(baseUrl) {
  let target
  try { target = new URL(baseUrl) } catch { throw Error('A plain HTTP provider URL is required for the host relay') }
  if (target.protocol !== 'http:' || target.username || target.password || target.search || target.hash) throw Error('A plain HTTP provider URL is required for the host relay')
  const sockets = new Set()
  const access = randomBytes(32).toString('hex')
  const prefix = target.pathname.replace(/\/$/, '') + '/'
  const server = http.createServer((request, response) => {
    const presented = request.headers[ACCESS_HEADER]
    if (typeof presented !== 'string' || Buffer.byteLength(presented) !== Buffer.byteLength(access)
      || !timingSafeEqual(Buffer.from(presented), Buffer.from(access)) || request.method !== 'POST'
      || !request.url.startsWith(prefix) || request.url.startsWith('//')) { response.writeHead(403).end(); return }
    const upstream = http.request({ hostname: target.hostname.replace(/^\[|\]$/g, ''), port: Number(target.port) || 80,
      method: 'POST', path: request.url, headers: { ...forwardedHeaders(request.headers), host: target.host }, agent: false,
    }, result => {
      response.writeHead(result.statusCode, forwardedHeaders(result.headers))
      result.pipe(response)
      result.on('error', () => response.destroy())
    })
    const connecting = setTimeout(() => upstream.destroy(), 5000)
    upstream.once('socket', socket => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      if (socket.connecting) socket.once('connect', () => clearTimeout(connecting))
      else clearTimeout(connecting)
    })
    upstream.on('error', () => { clearTimeout(connecting); if (response.headersSent) response.destroy(); else response.writeHead(502).end() })
    upstream.once('close', () => clearTimeout(connecting))
    request.once('aborted', () => upstream.destroy())
    response.once('close', () => upstream.destroy())
    request.pipe(upstream)
  })
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  server.maxConnections = 8
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port, authority = target.host
  const containerUrl = new URL(target)
  containerUrl.hostname = 'host.docker.internal'; containerUrl.port = String(port)
  let closing
  return { host: '127.0.0.1', port, baseUrl: containerUrl.href, authority, headers: { [ACCESS_HEADER]: access },
    close() {
      if (!closing) closing = new Promise((resolve, reject) => {
        for (const socket of sockets) socket.destroy()
        server.close(error => error ? reject(error) : resolve())
      })
      return closing
    },
  }
}
