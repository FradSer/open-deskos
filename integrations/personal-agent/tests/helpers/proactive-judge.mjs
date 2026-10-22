// Offline dependency double. Production decisions always come from Jev.
export async function fixtureJudge({ candidates }) {
  const ops = { lt: (a, b) => a < b, lte: (a, b) => a <= b, gt: (a, b) => a > b, gte: (a, b) => a >= b, eq: (a, b) => a === b }
  return { model: 'jev-fixture', answers: Object.fromEntries(candidates.map(c => [c.id, {
    probability: c.criteria.every(condition => {
      const e = c.evidence.find(e => e.readingId === condition.readingId && e.field === condition.field)
      return e && ops[condition.op](e.value, condition.value)
    }) ? 0.95 : 0.05, threshold: 0.8,
  }])) }
}
