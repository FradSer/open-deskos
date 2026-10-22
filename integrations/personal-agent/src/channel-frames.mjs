// Bound each JSON line separately. Pause the transport while an async handler runs.
export function readFrames(stream, handle, { maxFrame = 4096, maxBatch = 131072 } = {}) {
  let pending = Buffer.alloc(0)
  let running = false
  let stopped = false
  const fail = () => { stopped = true; stream.destroy() }
  async function consume() {
    if (running || stopped) return
    running = true
    stream.pause()
    try {
      let newline
      while (!stopped && !stream.destroyed && (newline = pending.indexOf(10)) >= 0) {
        if (newline > maxFrame) throw Error('Frame too large')
        const line = pending.subarray(0, newline).toString('utf8')
        pending = pending.subarray(newline + 1)
        const frame = JSON.parse(line)
        if (!frame || frame.v !== 1 || typeof frame.type !== 'string') throw Error('Invalid frame')
        await handle(frame)
      }
      if (pending.length > maxFrame) throw Error('Frame too large')
    } catch { fail() }
    finally { running = false; if (!stopped && !stream.destroyed) stream.resume() }
  }
  stream.on('data', chunk => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (pending.length + bytes.length > maxBatch) return fail()
    pending = Buffer.concat([pending, bytes])
    void consume()
  })
  stream.once('close', () => { stopped = true; pending = Buffer.alloc(0) })
  stream.on('error', fail)
}

// Do not retain a write after disconnect or let a slow peer grow an unbounded queue.
export function writeFrame(stream, frame, maxFrame = 131072) {
  const bytes = JSON.stringify(frame) + '\n'
  if (stream.destroyed || !stream.writable || Buffer.byteLength(bytes) > maxFrame
    || stream.writableLength + Buffer.byteLength(bytes) > 4 * maxFrame) return Promise.reject(Error('Channel unavailable'))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stream.off('close', closed)
      error ? reject(Error('Channel unavailable')) : resolve(undefined)
    }
    const closed = () => finish(Error('Channel closed'))
    const timer = setTimeout(closed, 10000)
    timer.unref?.()
    stream.once('close', closed)
    stream.write(bytes, finish)
  })
}
