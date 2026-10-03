import createFvad from '@echogarden/fvad-wasm'

export async function createWebRtcVad() {
  const wasm = await createFvad()
  const handle = wasm._fvad_new()
  const samples = wasm._malloc(640)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    if (samples) wasm._free(samples)
    if (handle) wasm._fvad_free(handle)
  }
  if (!handle || !samples || wasm._fvad_set_sample_rate(handle, 16000) !== 0 || wasm._fvad_set_mode(handle, 2) !== 0) {
    close()
    throw Error('Voice activity detection unavailable')
  }
  return {
    process(frame) {
      if (closed || frame.length !== 640) throw Error('Invalid voice activity frame')
      for (let i = 0; i < 320; i++) wasm.HEAP16[(samples >> 1) + i] = frame.readInt16LE(i * 2)
      const result = wasm._fvad_process(handle, samples, 320)
      if (result !== 0 && result !== 1) throw Error('Voice activity detection failed')
      return result === 1
    },
    close,
  }
}
