// Only known display fields leave the transaction store; no raw MCP messages.
export function rideNotification(snapshot) {
  const prefix = snapshot.sandbox ? '滴滴模拟订单（不是真实叫车）' : '滴滴订单'
  if (snapshot.phase === 'unknown' && snapshot.order?.statusUnavailable) {
    const text = typeof snapshot.order.statusText === 'string' ? snapshot.order.statusText.slice(0, 3000) : ''
    return `${prefix}：服务仅返回文字，无法验证订单终止状态；不要重复下单。请在滴滴 App 核实。\n服务消息（仅供参考）：\n${text}`
  }
  if (['unknown', 'submitting'].includes(snapshot.phase)) return `${prefix}：下单结果尚未确认，请先查询订单状态，不要重复下单。`
  if (['cancel_unknown', 'cancelling'].includes(snapshot.phase)) return `${prefix}：取消结果尚未确认，请先查询订单，不要重复取消。`
  if (!['active', 'terminal'].includes(snapshot.phase)) return ''
  const order = snapshot.order || {}
  const labels = { '0': '正在匹配司机', '1': '司机已接单', '2': '司机已到达，请准备上车', '4': '行程中', '5': '行程已完成' }
  const state = snapshot.phase === 'terminal' && String(order.statusCode) !== '5' ? '订单已结束' : labels[String(order.statusCode)] || '请查询最新状态'
  const fields = [order.driver?.name, order.driver?.carModel, order.driver?.carPlate].filter(value => typeof value === 'string').map(value => value.slice(0, 120))
  if (typeof order.map?.eta === 'string') fields.push(`预计 ${order.map.eta.slice(0, 20)} 分钟`)
  return `${prefix}：${state}${fields.length ? '\n' + fields.join(' · ') : ''}`
}
