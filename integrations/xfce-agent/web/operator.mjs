const status = document.querySelector('#status');
let ticket, display;
async function call(method, value = {}, verb = 'POST') {
  const task = document.querySelector('#task').value.trim();
  const response = await fetch('/operator/tasks/' + encodeURIComponent(task) + '/' + method, { method: verb, ...(verb === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) } : {}) });
  const result = await response.json();
  if (!result.ok) throw Error(result.error?.code ?? 'Operator request refused');
  if (result.result.status !== undefined) ticket = result.result.ticket;
  status.textContent = JSON.stringify({ status: result.result.status, revision: result.result.revision, mutationOutcome: result.result.mutationOutcome }, null, 2);
  return result.result;
}
const run = action => async () => { try { await action(); } catch (error) { status.textContent = error.message; } };
document.querySelector('#authenticate').onsubmit = async event => {
  event.preventDefault();
  const input = document.querySelector('#token');
  const response = await fetch('/operator/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: input.value }) });
  input.value = '';
  if ((await response.json()).ok) { document.querySelector('#authenticate').hidden = true; document.querySelector('#controls').hidden = false; }
  else status.textContent = 'Operator authentication failed.';
};
document.querySelector('#refresh').onclick = run(() => call('status', {}, 'GET'));
document.querySelector('#pause').onclick = run(() => call('pause'));
document.querySelector('#cancel').onclick = run(async () => { display?.disconnect(); await call('cancel'); });
document.querySelector('#resume').onclick = run(async () => {
  if (!ticket) throw Error('Read the current private task status first.');
  display?.disconnect();
  await call('resume', ticket);
  ticket = undefined;
});
document.querySelector('#connect').onclick = run(async () => {
  const current = await call('status', {}, 'GET');
  if (current.status !== 'waiting_for_user') throw Error('Private handoff is not ready.');
  const { default: RFB } = await import('/operator/novnc/core/rfb.js');
  display?.disconnect();
  const target = document.querySelector('#display'); target.replaceChildren();
  const websocket = new URL('/operator/tasks/' + encodeURIComponent(current.taskId) + '/vnc', location.href);
  websocket.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  websocket.search = new URLSearchParams(current.ticket).toString();
  display = new RFB(target, websocket.href);
  display.scaleViewport = true;
  display.clipViewport = false;
});
