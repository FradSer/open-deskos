const { admitFixture, settleFixture, fixtureOwner } = require('../../scripts/lib/release-ledger')
const [directory, raw] = process.argv.slice(2)
const payload = JSON.parse(raw)
process.send({ ready: true })
process.once('message', async () => {
  try {
    const operation = payload.operation === 'settle' ? settleFixture : admitFixture
    const result = await operation({ ...payload, directory, ...(payload.request ? { request: { ...payload.request, owner: payload.preserveLeaseOwner ? payload.request.owner : fixtureOwner() } } : {}), checkpoint: async phase => {
      if (phase === payload.failAt) { const error = Error('injected_persistence_failure'); error.code = 'injected_persistence_failure'; throw error }
      if (phase === payload.pauseAt) {
        setInterval(() => {}, 1000)
        process.send({ checkpoint: phase })
        await new Promise(() => {})
      }
    } })
    process.send({ result }, () => process.disconnect())
  } catch (error) { process.send({ result: { ok: false, code: error.code ?? 'fixture_error' } }, () => process.disconnect()) }
})
