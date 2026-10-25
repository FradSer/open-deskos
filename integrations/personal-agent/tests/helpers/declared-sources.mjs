import { createProducerControl } from '../../src/producer-readings.mjs'
const { loadShellModule } = await import('../../src/plugin-composition.mjs')
const { createShellOdkData } = loadShellModule('odk-data.js')
const { createPersonalAgentReadingSource } = loadShellModule('personal-agent-readings.js')

/** Exercise actual producer dispatch, service declarations and the single registry. */
export async function declaredSources({ readings = [], providers = [] }) {
  const control = createProducerControl({ ports: () => providers, current: () => true })
  const source = createPersonalAgentReadingSource({ request: async ({ request }) => {
    const result = await control.dispatch(request)
    if (!result.ok) throw Error(result.error)
    return result
  } })
  await source.refresh()
  const data = createShellOdkData({ readings: readings.map(entry => ({ ...entry, read: async () => entry })), serviceReadings: source.readings })
  return { list: async () => data.registry.list(), read: async id => {
    const result = await data.registry.read(id)
    if (!result.ok) throw Error(result.error)
    return result.reading
  }, close: () => source.close() }
}
