const http = require('node:http')
const https = require('node:https')

function readBody(response) {
  return new Promise((resolve) => {
    let body = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => { body += chunk })
    response.on('end', () => resolve(body))
    response.on('error', () => resolve(null))
  })
}

async function checkCompanionHealth(endpoint, timeoutMs = 1500) {
  const url = new URL(endpoint)
  const transport = url.protocol === 'https:' ? https : http
  return new Promise((resolve) => {
    const request = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      timeout: timeoutMs,
    }, async (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume()
        resolve(false)
        return
      }
      const body = await readBody(response)
      try {
        const payload = JSON.parse(body)
        resolve(
          typeof payload.service === 'string' &&
          payload.service.includes('OpenDeskOS') &&
          payload.ready === true,
        )
      } catch {
        resolve(false)
      }
    })

    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })
    request.on('error', () => resolve(false))
    request.end()
  })
}

module.exports = { checkCompanionHealth }
