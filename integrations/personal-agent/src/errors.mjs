export class AudioLimitError extends Error {
  constructor(limit) {
    super('Audio too large')
    this.limit = limit
  }
}

const JUDGMENT_PHASES = new Set(['unknown', 'route', 'judgment_input', 'model_selection', 'model_request', 'ordinary_validate', 'normalize', 'configuration', 'create', 'prompt', 'parse', 'validate', 'correction', 'dispose'])
const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'TimeoutError', 'AggregateError', 'other', 'none'])
const ERROR_CODES = new Set(['ABORT_ERR', 'ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'other', 'none'])
const CLEANUP_STATES = new Set(['not_recorded', 'not_started', 'completed', 'failed', 'pending'])
const property = (value, key) => { try { return value?.[key] } catch { return 'other' } }

/** Only closed enums and bounded counters can cross the diagnostic boundary. */
export function projectJudgmentDiagnostic(value) {
  const phase=property(value,'phase'), name=property(value,'errorName'), code=property(value,'errorCode')
  const cleanup=property(value,'cleanup'), attempt=property(value,'attempt'), turn=property(value,'turn')
  const cleanupName=property(value,'cleanupErrorName'), cleanupCode=property(value,'cleanupErrorCode')
  return Object.freeze({
    phase:JUDGMENT_PHASES.has(phase)?phase:'unknown',
    errorName:ERROR_NAMES.has(name)?name:'other', errorCode:ERROR_CODES.has(code)?code:'other',
    cleanup:CLEANUP_STATES.has(cleanup)?cleanup:'not_recorded',
    attempt:Number.isInteger(attempt)&&attempt>=0&&attempt<=2?attempt:null,
    timedOut:property(value,'timedOut')===true, cancelled:property(value,'cancelled')===true,
    cleanupErrorName:cleanupName===undefined?'none':ERROR_NAMES.has(cleanupName)?cleanupName:'other',
    cleanupErrorCode:cleanupCode===undefined?'none':ERROR_CODES.has(cleanupCode)?cleanupCode:'other',
    turn:Number.isSafeInteger(turn)&&turn>0?turn:null,
  })
}

/** Never read error text, stacks, causes, model settings, or supplied content. */
export function judgmentFailureRecord(phase, error, {cleanup='not_recorded',attempt=null,timedOut=false,cancelled=false,cleanupError=undefined,turn=null}={}) {
  const code=property(error,'code'), cleanupCode=property(cleanupError,'code')
  return projectJudgmentDiagnostic({phase,errorName:property(error,'name'),errorCode:code===undefined?'none':code,
    cleanup,attempt,timedOut,cancelled,turn,cleanupErrorName:cleanupError===undefined?'none':property(cleanupError,'name'),
    cleanupErrorCode:cleanupError===undefined||cleanupCode===undefined?'none':cleanupCode})
}

/** Observation failures never participate in routing, deadlines, or cleanup. */
export function reportJudgmentDiagnostic(observer, value) {
  if(typeof observer!=='function')return
  try { void Promise.resolve(observer(projectJudgmentDiagnostic(value))).catch(()=>{}) } catch { /* Keep the original control flow. */ }
}
