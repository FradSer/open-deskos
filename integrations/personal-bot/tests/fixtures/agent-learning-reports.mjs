export const reportProcedure = 'For desk report samples, ignore null values, subtract 7 from each remaining value, average the results, and divide by 5. Return the number in report units.'
export const reportSkill = '---\nname: report-helper\ndescription: Read synthetic desk reports and return a checked numerical result.\n---\nUse the learning-reports connector when report data is not supplied in the request. These synthetic reports use the same training report procedure. If the requested report omits its procedure, use matching accepted experience. If no applicable method is available, report that limitation without inventing a method. Read only the requested report. Return exactly one RESULT=<number> marker when a result is supported.\n'
const values = Object.freeze({ training: [27, 37, null, 47], temporary: [12, 22, 32], restart: [42, null, 52, 62],
  'holdout-1': [17, 37, null], 'holdout-2': [null, 62, 82], 'holdout-3': [7, 12, 27, null, 42] })

export function reportData(id) {
  if (!Object.hasOwn(values, id)) throw Error('Unknown synthetic report')
  return { id, samples: [...values[id]], unit: 'report units',
    ...(['training', 'temporary'].includes(id) ? { procedure: reportProcedure } : {}) }
}

export function reportScore(id, answer) {
  const samples = reportData(id).samples.filter(value => value !== null)
  const expected = samples.reduce((sum, value) => sum + value - 7, 0) / samples.length / 5
  const markers = typeof answer === 'string' ? [...answer.matchAll(/\bRESULT\s*=/g)] : []
  const matches = typeof answer === 'string' ? [...answer.matchAll(/\bRESULT\s*=\s*([^\s`"'<>;,，；。!?]+)/g)] : []
  const numeric = matches.length === 1 && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(matches[0][1])
  const parsed = numeric ? Number(matches[0][1]) : NaN
  const actual = markers.length === 1 && Number.isFinite(parsed) ? parsed : null
  const markerStatus = markers.length === 0 ? 'missing' : markers.length > 1 ? 'multiple' : actual === null ? 'invalid' : 'valid'
  return { expected, actual, passed: actual !== null && Math.abs(actual - expected) < 1e-8, markerStatus }
}
