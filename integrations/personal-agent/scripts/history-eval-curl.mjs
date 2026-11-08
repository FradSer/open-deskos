import { spawn } from 'node:child_process'

const textParts = parts => parts.filter(part => part.type === 'text').map(part => part.text).join('')

function chatMessage(message) {
  if (message.role === 'toolResult') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: textParts(message.content) }
  }
  if (message.role === 'assistant') {
    const calls = message.content.filter(part => part.type === 'toolCall').map(part => ({
      id: part.id, type: 'function', function: { name: part.name, arguments: JSON.stringify(part.arguments) },
    }))
    return { role: 'assistant', content: textParts(message.content) || null, ...(calls.length ? { tool_calls: calls } : {}) }
  }
  return { role: message.role, content: message.content }
}

function curl(url, body, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['--disable', '--silent', '--noproxy', '*', '--max-time', String(timeoutMs / 1000),
      '--variable', '%ODK_HISTORY_CURL_KEY', '--expand-header', 'Authorization: Bearer {{ODK_HISTORY_CURL_KEY}}',
      '--header', 'Content-Type: application/json', '--data-binary', '@-', '--write-out', '\n%{http_code}', '--url', url],
    { signal, stdio: ['pipe', 'pipe', 'ignore'] })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
      if (stdout.length > 1024 * 1024) child.kill()
    })
    child.on('error', error => reject(error.code === 'ENOENT' ? Error('evaluation:curl_unavailable') : error))
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(body))
    child.on('close', code => {
      if (code === 28) return reject(Error('curl timeout'))
      if ([5, 6, 7, 18, 52, 55, 56].includes(code)) return reject(Error('curl temporary transport error'))
      if (code !== 0) return reject(Error('evaluation:curl_failed'))
      const boundary = stdout.lastIndexOf('\n')
      const status = Number(stdout.slice(boundary + 1))
      if (status < 200 || status >= 300) return reject(Error('HTTP ' + status))
      try { resolve(JSON.parse(stdout.slice(0, boundary))) }
      catch { reject(Error('evaluation:invalid_chat_response')) }
    })
  })
}

export function createCurlCompletion(url, timeoutMs) {
  const endpoint = new URL(url)
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) {
    throw Error('Invalid Chat Completions URL')
  }
  if (!process.env.ODK_HISTORY_CURL_KEY || /[\r\n]/.test(process.env.ODK_HISTORY_CURL_KEY)) throw Error('Set ODK_HISTORY_CURL_KEY')
  return async (model, context, { maxTokens, signal }) => {
    const messages = context.messages.map(chatMessage)
    if (context.systemPrompt) messages.unshift({ role: 'system', content: context.systemPrompt })
    const tools = context.tools?.map(tool => ({ type: 'function', function: tool }))
    const data = await curl(endpoint.href, { model: model.id, messages, temperature: 0, reasoning_effort: 'none', max_completion_tokens: maxTokens,
      ...(tools?.length ? { tools } : {}) }, signal, timeoutMs)
    const choice = data.choices?.[0]
    if (!choice?.message) throw Error('evaluation:invalid_chat_response')
    const content = []
    const text = choice.message.content ?? choice.message.refusal
    if (typeof text === 'string' && text) content.push({ type: 'text', text })
    for (const call of choice.message.tool_calls ?? []) {
      let args
      try { args = JSON.parse(call.function.arguments) } catch { args = {} }
      content.push({ type: 'toolCall', id: call.id, name: call.function.name, arguments: args })
    }
    const cacheRead = data.usage?.prompt_tokens_details?.cached_tokens ?? 0
    const cacheWrite = data.usage?.prompt_tokens_details?.cache_write_tokens ?? 0
    const stopReason = { length: 'length', tool_calls: 'toolUse' }[choice.finish_reason] ?? 'stop'
    return { role: 'assistant', content, stopReason, model: data.model,
      usage: { input: Math.max(0, (data.usage?.prompt_tokens ?? 0) - cacheRead - cacheWrite), output: data.usage?.completion_tokens ?? 0, cacheRead, cacheWrite } }
  }
}
