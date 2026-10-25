import { createJevIntentRouter } from '../../src/intent-routing.mjs'

/** Offline TypeSafe API fixture, exercising the real parser without provider access. */
export function fixtureIntentRouter() {
  return createJevIntentRouter({ env: { TYPESAFE_API_KEY: 'fixture-only' }, fetchImpl: async (_url, options) => {
    const { state, questions } = JSON.parse(options.body)
    // Exact fixtures are test data, never a production keyword fallback.
    const intent = state.text === '最近有什么建议' ? 'suggestions'
      : state.pendingConfirmations?.some(p => p.confirmation === state.text) || state.text.startsWith('确认执行 ') ? 'proposal_response' : 'conversation'
    return Response.json({ model: 'jev-fixture', answers: { intent: { type: 'choice', choice: intent, confidence: 1,
      probabilities: Object.fromEntries(Object.keys(questions.intent.criteria).map(key => [key, key === intent ? 1 : 0])) } } })
  } })
}
