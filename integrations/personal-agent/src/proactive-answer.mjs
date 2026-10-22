function measuredEvidence(evidence) {
  const value = String(evidence.value)
  let detail
  if (evidence.field === 'temperatureC') detail = `气温 ${value}°C`
  else if (evidence.field.endsWith('soilPercent')) detail = `土壤湿度 ${value}%`
  else if (evidence.field === 'turnOutcome') detail = '任务回合已完成'
  else if (evidence.field === 'verification') detail = ({ not_run: '尚未验证', passed: '验证通过', failed: '验证失败' })[value] ?? `验证状态 ${value}`
  else detail = `${evidence.field}：${value}`
  return `${detail}（测量时间 ${evidence.measuredAt}）`
}

/** Read only the host's current proposal store; no historical model output or action calls. */
export async function answerSuggestions(watch) {
  if (!watch) return '主动建议尚未启用，暂时没有实时建议可供查询。'
  let proposals
  try { proposals = await watch.readProposals() } catch { return '当前无法读取实时建议，请稍后重试。' }
  const pending = proposals.filter(p => p.status === 'pending')
  const uncertain = proposals.some(p => ['executing', 'unknown'].includes(p.status))
  const caution = uncertain ? '\n另有动作的执行结果尚未确认，请先核实，不要重复执行。' : ''
  if (!pending.length) return `目前没有基于最新读数触发的新建议。${caution}`
  const shown = pending.slice(0, 5)
  const items = shown.map((p, i) => `${i + 1}. ${p.advice}\n依据：${p.evidence.map(measuredEvidence).join('；')}${p.action ? `\n尚未执行。如要执行，请另行确认：“${p.confirmation}”。` : ''}`)
  const remaining = pending.length > shown.length ? `\n还有 ${pending.length - shown.length} 条，请在建议面板查看。` : ''
  return `当前有 ${pending.length} 条建议：\n\n${items.join('\n\n')}${remaining}${caution}`
}
