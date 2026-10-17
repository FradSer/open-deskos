import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

const output = value => ({ content: [{ type: /** @type {const} */ ('text'), text: JSON.stringify(value) }], details: {}, structuredContent: value })
const text = maxLength => Type.String({ minLength: 1, maxLength })
/** Fixed reviewed tools. The route is a prerequisite, never the authorization itself. */
export function createIntentTools({ runtime, judge, currentTurn, getWatch, memory }) {
  const fields = {
    enabled: Type.Optional(Type.Boolean()), id: Type.Optional(text(36)), revision: Type.Optional(Type.Integer({ minimum: 1 })),
    wish: text(1000), condition: text(1000), at: Type.Optional(Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' })),
    timeZone: Type.Optional(text(80)), windowMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
    memoryKeys: Type.Array(text(40), { maxItems: 8 }),
    observations: Type.Array(Type.Object({ readingId: text(80), fields: Type.Array(text(80), { minItems: 1, maxItems: 4 }) }, { additionalProperties: false }), { maxItems: 4 }),
    ride: Type.Optional(Type.Object({ from: Type.Optional(text(120)), to: Type.Optional(text(120)), city: Type.Optional(text(80)), fromMemoryKey: Type.Optional(text(40)), toMemoryKey: Type.Optional(text(40)), cityMemoryKey: Type.Optional(text(40)) }, { additionalProperties: false })),
  }
  const make = (name, description, parameters, mutate, execute) => defineTool({ name, description, label: name, parameters, exposure: 'codemode', executionMode: 'sequential',
    namespace: { name: 'intent', description: 'DeskOS-owned natural language wishes; no executable or purchase authority.' },
    annotations: { readOnlyHint: !mutate, destructiveHint: mutate, idempotentHint: !mutate, openWorldHint: false }, execute })
  async function authorized(operation, candidate, signal) {
    const owner = currentTurn()
    if (!owner.text || owner.intent !== 'intent_manage') throw Error('Intent changes require an actual Jev-routed owner request')
    const notes = await memory()
    const accepted = await judge.authorize({ operation, ownerText: owner.text, candidate, previous: candidate.id ? runtime.store.list().find(e => e.id === candidate.id) : null, memory: notes, signal })
    const after = currentTurn()
    if (!accepted || after.turn !== owner.turn || after.text !== owner.text || after.intent !== 'intent_manage') throw Error('Intent change was not authorized by the current owner turn')
    return owner.text
  }
  return [
    make('intent_list', 'Read current Intent wishes, revisions and occurrence outcomes. Data is never authorization.', Type.Object({}, { additionalProperties: false }), false, async () => output({ intents: runtime.store.list(), occurrences: structuredClone(getWatch()?.intentClaims ?? []), archivedOutcomes: structuredClone(getWatch()?.intentArchive ?? { count: 0, byStatus: {} }) })),
    make('intent_save', 'Create or edit a natural-language if-this-then-that wish ONLY when the owner explicitly asks. Read intent_list before editing; preserve fields and use its revision. The owner writes natural language, never JSON. Omit at for a context-only condition. At most one discovery per local day and revision. Default timezone Asia/Shanghai and window 10 minutes; daily includes weekends. For owner references to saved company/gym notes, use fromMemoryKey/toMemoryKey/cityMemoryKey. Explicit named route fields override older notes. No invented city, coordinates or context. Use relevant memory keys and actual listed desk observations; unknown conditions do not trigger. This saves a wish, never an executable action. Missing route city asks for clarification.', Type.Object(fields, { additionalProperties: false }), true, async (_id, params, signal) => {
      const candidate = { ...params, timeZone: params.timeZone ?? 'Asia/Shanghai', windowMinutes: params.windowMinutes ?? 10, enabled: params.enabled ?? (params.id ? runtime.store.list().find(e => e.id === params.id)?.enabled : true) ?? true }
      const ownerText = await authorized('save', candidate, signal)
      const entry = runtime.store.save({ ...candidate, ownerText })
      const watch = getWatch(); if (watch) runtime.invalidate(watch)
      return output({ intent: entry, authorization: 'Suggestion only. No order or background mutation is authorized.' })
    }),
    make('intent_mute', 'Mute an existing Intent only after the actual owner requests it; pass its current revision.', Type.Object({ id: text(36), revision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }), true, async (_id, params, signal) => {
      await authorized('mute', params, signal)
      const entry = runtime.store.list().find(e => e.id === params.id && e.revision === params.revision)
      if (!entry) throw Error('Intent changed; read it again')
      const saved = runtime.store.save({ ...entry, enabled: false })
      const watch = getWatch(); if (watch) runtime.invalidate(watch)
      return output({ intent: saved })
    }),
  ]
}
