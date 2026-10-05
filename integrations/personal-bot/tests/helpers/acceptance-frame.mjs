// One-shot observer for the optional device acceptance process, not a client
// that can retry commands. Callers validate the exact expected fixture reply.
export function observeAcceptanceFrame(child, { acceptanceId, validate, timeoutMs = 30_000, maxBytes = 262_144 }) {
  return new Promise((resolve, reject) => {
    let output = '', settled = false
    const cleanup = () => {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.stdout.off('end', onEnd)
      child.stdout.off('error', onError)
      child.off('error', onError)
      child.off('close', onClose)
    }
    const finish = (error, value) => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      cleanup()
      if (error) reject(error); else resolve(value)
    }
    const onData = data => {
      output += data
      if (Buffer.byteLength(output) > maxBytes) return finish(Error('Oversized acceptance frame'))
      const newline = output.indexOf('\n')
      if (newline < 0) return
      try {
        if (output.slice(newline + 1).trim()) throw Error('Multiple acceptance frames')
        const frame = JSON.parse(output.slice(0, newline))
        if (frame.acceptanceId !== acceptanceId) throw Error('Invalid acceptance correlation')
        validate(frame)
        finish(null, frame.result)
      } catch (error) { finish(error) }
    }
    const onEnd = () => finish(Error('Acceptance frame incomplete; no mutation retry'))
    const onError = () => finish(Error('Acceptance transport failed; no mutation retry'))
    const onClose = () => finish(Error('Acceptance transport closed before reply; no mutation retry'))
    const timer = setTimeout(() => finish(Error('Acceptance observation timeout; no mutation retry')), timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', onData)
    child.stdout.once('end', onEnd)
    child.stdout.once('error', onError)
    child.once('error', onError)
    child.once('close', onClose)
  })
}
