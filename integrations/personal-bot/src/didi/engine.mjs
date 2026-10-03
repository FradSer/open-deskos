import { mkdir, lstat, readFile, open, rename, unlink, rmdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';

export class DidiError extends Error {}

const blocked = phase => ['submitting','unknown','active','cancelling','cancel_unknown'].includes(phase);
const statusCode = value => (typeof value === 'number' && Number.isInteger(value)) || typeof value === 'string' ? (['0','1','2','4','5'].includes(String(value)) ? String(value) : null) : null;
const interval = status => ['0','1'].includes(statusCode(status)) ? 30000 : ['2','4'].includes(statusCode(status)) ? 60000 : null;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;

/** A single resident controller owns each state file. No automatic mutation retries. */
export async function createRideEngine({stateFile, call, sandbox = true, now = Date.now, quoteTtlMs = 120000, onUpdate = (_snapshot) => {}, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = timer => clearTimeout(timer)}) {
  const dir = dirname(stateFile);
  await mkdir(dir, {recursive:true,mode:0o700});
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== process.getuid?.()) throw new DidiError('打车状态目录必须为当前用户私有目录。');
  const lock = `${stateFile}.lock`;
  try { await mkdir(lock,{mode:0o700}); }
  catch {
    const recovery = `${lock}.recover`;
    try { await mkdir(recovery,{mode:0o700}); } catch { throw new DidiError('打车状态正在恢复；请人工核实。'); }
    try {
    let pid;
    try { pid=Number(await readFile(`${lock}/pid`,'utf8')); } catch { throw new DidiError('打车状态已被占用；请人工检查锁。'); }
    if(!Number.isSafeInteger(pid) || pid<=0) throw new DidiError('打车状态锁无效。');
    try { process.kill(pid,0); throw new DidiError('打车服务已在运行。'); }
    catch(error) { if(error.code!=='ESRCH') throw new DidiError('打车服务已在运行或无法核实。'); }
    // A unique rename prevents two stale-lock recoverers from both owning the old lock.
    const stale=`${lock}.${randomUUID()}.stale`;
    await rename(lock,stale);await unlink(`${stale}/pid`);await rmdir(stale);
    await mkdir(lock,{mode:0o700});
    } finally { await rmdir(recovery); }
  }
  const pidFile=await open(`${lock}/pid`,'wx',0o600);try {await pidFile.writeFile(String(process.pid));} finally {await pidFile.close();}
  const release = async () => {await unlink(`${lock}/pid`);await rmdir(lock);};
  let state = {version:1,sandbox,phase:'idle',quote:null,proposal:null,order:null,reconciliation:null};
  try {
    const info = await lstat(stateFile);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576 || (info.mode & 0o077) || info.uid !== process.getuid?.()) throw Error();
    state = JSON.parse(await readFile(stateFile,'utf8'));
    if (state.version !== 1 || state.sandbox !== sandbox || (['active','cancelling','cancel_unknown'].includes(state.phase) && !state.order) || (state.order && !text(state.order.orderId)) || (state.quote && (!text(state.quote.id) || !text(state.quote.traceId) || !Number.isFinite(state.quote.expiresAt) || !Array.isArray(state.quote.items))) || !['idle','quoted','proposed','submitting','unknown','active','cancelling','cancel_unknown','terminal'].includes(state.phase)) throw Error();
  } catch (error) { if (error.code !== 'ENOENT') {await release();throw new DidiError('无法安全读取打车状态；请人工检查，禁止重新下单。');} }
  if (state.phase === 'submitting') state.phase = 'unknown';
  if (state.phase === 'cancelling') state.phase = 'cancel_unknown';
  // Confirmation authority is deliberately volatile and cannot survive restart.
  let turn = 0; let userText = ''; let proposalTurn = -1; let timer; let closed = false; let queue = Promise.resolve();
  const places = new Set();
  const snapshot = () => structuredClone(state);
  const save = async () => {
    const temporary = `${stateFile}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary,'wx',0o600);
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
      await rename(temporary,stateFile);
      const directory = await open(dir,'r');try { await directory.sync(); } finally { await directory.close(); }
    } finally { await unlink(temporary).catch(() => {}); }
    try { await onUpdate(snapshot()); } catch { /* UI failure cannot affect purchase state. */ }
  };
  const serial = operation => {
    const task = queue.then(() => { if (closed) throw new DidiError('打车服务已关闭。'); return operation(); });
    queue = task.catch(() => {}); return task;
  };
  const disarm = () => { userText=''; proposalTurn=-1; };
  const requireFree = () => { if(blocked(state.phase)) throw new DidiError('已有订单或结果不明；请先查询或人工核实。'); };
  const requireQuote = () => { if(!state.quote || now() >= state.quote.expiresAt) { disarm(); throw new DidiError('报价已过期；请重新估价并确认。'); } };
  const authorized = kind => {
    if (!state.proposal || state.proposal.kind !== kind || proposalTurn < 0 || turn <= proposalTurn || userText.replace(/[\s，。！？,.!?]/g,'') !== state.proposal.confirmationPhrase.replace(/\s/g,'')) throw new DidiError('请在下一次用户输入中完整回复确认口令。');
    disarm();
  };
  const schedule = () => {
    if(timer) clearTimer(timer); timer=null;
    if(closed || !['active','cancel_unknown','unknown'].includes(state.phase)) return;
    const ms = state.phase === 'unknown' || state.order?.statusUnavailable === true ? 30000 : interval(state.order?.statusCode) ?? (state.phase === 'cancel_unknown' ? 30000 : null);
    if(ms) { timer=setTimer(() => { api.status().catch(() => { if(!closed) schedule(); }); },ms); timer?.unref?.(); }
  };
  const api = {
    beginTurn(input) { turn++; userText=typeof input === 'string' ? input : ''; },
    snapshot,
    search: args => serial(async () => {
      if(!text(args.keywords) || !text(args.city)) throw new DidiError('请提供地点关键词及完整城市名称。');
      const result = await call('maps_textsearch',{keywords:args.keywords,city:args.city});
      const valid=result.filter(p=>text(p.display_name) && Number.isFinite(p.location?.lng) && Number.isFinite(p.location?.lat));
      for(const p of valid) places.add(JSON.stringify([p.display_name,String(p.location.lng),String(p.location.lat)]));
      return valid;
    }),
    estimate: route => serial(async () => {
      requireFree(); disarm(); state.proposal=null;state.quote=null;state.order=null;state.phase='idle'; await save();
      for(const prefix of ['from','to']) {
        if(!places.has(JSON.stringify([route[`${prefix}_name`],route[`${prefix}_lng`],route[`${prefix}_lat`]]))) throw new DidiError('起终点必须使用本次地点搜索返回的名称和坐标。');
      }
      const args=Object.fromEntries(['from_lng','from_lat','from_name','to_lng','to_lat','to_name'].map(k=>[k,route[k]]));
      const result=await call('taxi_estimate',args);
      if(!text(result.traceId) || !Array.isArray(result.items) || !result.items.length || !result.items.every(p=>text(p.productName)&&text(p.productCategory)&&text(p.priceText))) throw new DidiError('滴滴报价数据不完整。');
      state.quote={id:randomUUID(),traceId:result.traceId,items:result.items,route:args,expiresAt:now()+quoteTtlMs};state.phase='quoted';await save();return snapshot().quote;
    }),
    propose: ({productCategory}) => serial(async () => {
      requireFree();requireQuote();const product=state.quote.items.find(p=>p.productCategory===productCategory);if(!product) throw new DidiError('请选择报价中存在的车型。');
      disarm();const nonce=String(randomInt(100000,1000000));const confirmationPhrase=`确认叫车 ${product.productName} ${nonce}`;
      state.proposal={kind:'create',quoteId:state.quote.id,product,confirmationPhrase};proposalTurn=turn;state.phase='proposed';await save();
      return {sandbox,route:state.quote.route,product,expiresAt:state.quote.expiresAt,confirmationPhrase};
    }),
    submit: () => serial(async () => {
      requireFree();requireQuote();if(state.proposal?.quoteId!==state.quote.id) throw new DidiError('报价发生变化，请重新确认。');authorized('create');
      state.phase='submitting';await save();
      try {
        const result=await call('taxi_create_order',{product_category:state.proposal.product.productCategory,estimate_trace_id:state.quote.traceId});
        if(!text(result.orderId)) throw Error();
        state.order={...result,statusCode:result.statusCode ?? 0};state.phase='active';
      } catch { state.phase='unknown'; }
      state.proposal=null;await save();schedule();return snapshot();
    }),
    status: () => serial(async () => {
      const result=await call('taxi_query_order',state.order ? {order_id:state.order.orderId} : {});
      if(result.statusUnavailable === true && (typeof result.statusText !== 'string' || !result.statusText.trim() || result.statusText.length > 4096)) throw new DidiError('订单状态说明缺失或过长；请稍后查询。');
      if(state.order) {
        if(Object.hasOwn(result,'orderId') && (!text(result.orderId) || result.orderId!==state.order.orderId)) throw new DidiError('订单查询身份不匹配；请人工核实。');
        if(result.statusUnavailable === true) {
          // Keep the last machine status as history, never infer authority from prose.
          state.order={...state.order,statusUnavailable:true,statusText:result.statusText};
          state.phase=state.phase==='cancel_unknown' ? 'cancel_unknown' : 'unknown';
          state.proposal=null;disarm();
        } else {
          if(result.statusCode===undefined) throw new DidiError('订单状态缺失；请稍后查询。');
          state.order={...state.order,...result,orderId:state.order.orderId};
          delete state.order.statusUnavailable;delete state.order.statusText;
          state.phase=statusCode(result.statusCode)==='5' ? 'terminal' : state.phase==='cancel_unknown' ? 'cancel_unknown' : interval(result.statusCode) ? 'active' : 'unknown';
        }
      } else {
        // Account-current order is evidence, never proof of an ambiguous submission's identity.
        state.reconciliation={observedAt:now(),currentOrder:result,identityVerified:false};
        if((text(result.orderId) || result.statusUnavailable === true) && state.phase!=='unknown') {state.phase='unknown';disarm();}
      }
      await save();schedule();return snapshot();
    }),
    proposeCancel: ({reason='' } = {}) => serial(async () => {
      if(state.phase!=='active' || !state.order || !['0','1','2'].includes(statusCode(state.order.statusCode))) throw new DidiError('当前订单无法取消或结果尚不明确。');
      if(typeof reason!=='string' || reason.length>512) throw new DidiError('取消原因过长。');
      disarm();state.proposal={kind:'cancel',orderId:state.order.orderId,reason,confirmationPhrase:`确认取消订单 ${randomInt(100000,1000000)}`};proposalTurn=turn;await save();return structuredClone(state.proposal);
    }),
    cancel: () => serial(async () => {
      if(state.phase!=='active' || !state.order || state.proposal?.orderId!==state.order.orderId || !['0','1','2'].includes(statusCode(state.order.statusCode))) throw new DidiError('当前订单无法取消。');
      authorized('cancel');state.phase='cancelling';await save();
      try { const result=await call('taxi_cancel_order',{order_id:state.order.orderId,reason:state.proposal.reason});state.phase=result.success===true ? 'terminal' : 'cancel_unknown'; }
      catch { state.phase='cancel_unknown'; }
      state.proposal=null;await save();schedule();return snapshot();
    }),
    driverLocation: () => serial(async () => {
      if(state.phase!=='active' || !state.order) throw new DidiError('没有已确认的进行中订单。');
      return call('taxi_get_driver_location',{order_id:state.order.orderId});
    }),
    async close() { if(closed) return;closed=true; if(timer) clearTimer(timer); disarm();await queue;await release(); },
  };
  try { await save(); schedule();return api; } catch(error) { await release();throw error; }
}
