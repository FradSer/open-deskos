#!/usr/bin/env node
import { loadTaskConfig } from './task-store.mjs';
import { readFrame, requestTask, streamTaskCompletions, REQUEST_LIMIT, RESPONSE_LIMIT } from './task-protocol.mjs';

const deadline = setTimeout(() => { process.stderr.write('任务请求超时，结果未知；请使用原任务 ID 查询\n'); process.exit(1); }, 9000);
try {
  const request = await readFrame(process.stdin, REQUEST_LIMIT);
  process.stdin.pause();
  const config = await loadTaskConfig();
  if(request.command==='subscribe_completions') {
    clearTimeout(deadline)
    const controller=new AbortController()
    let heartbeat
    const stop=()=>controller.abort()
    const write=record=>{
      if(process.stdout.writableLength>RESPONSE_LIMIT){stop();return}
      process.stdout.write(JSON.stringify(record)+'\n',error=>{if(error)stop()})
    }
    process.once('SIGTERM',stop);process.once('SIGINT',stop);process.stdout.once('error',stop);process.stdout.once('close',stop)
    try { await streamTaskCompletions(config.socketPath,request,record=>{
      write(record)
      if(record.subscription==='completions' && !heartbeat)heartbeat=setInterval(()=>write({version:1,requestId:request.requestId,type:'heartbeat'}),15000)
    },controller.signal) } catch(error) {
      if(error.message!=='Completion subscription unsupported')throw error
      process.stdout.write(JSON.stringify({version:1,requestId:request.requestId,ok:false,error:'Completion subscription unavailable'})+'\n')
    } finally {
      clearInterval(heartbeat)
      process.off('SIGTERM',stop);process.off('SIGINT',stop);process.stdout.off('error',stop);process.stdout.off('close',stop)
    }
  } else {
  const response = await requestTask(config.socketPath, request);
  if (response?.version !== 1 || response?.requestId !== request?.requestId || typeof response?.ok !== 'boolean') throw new Error('任务响应无效');
  process.stdout.write(`${JSON.stringify(response)}\n`);
  }
} catch {
  process.stderr.write('任务通信失败，执行结果未知；请使用原任务 ID 查询\n');
  process.exitCode = 1;
} finally { clearTimeout(deadline); process.stdin.destroy(); }
