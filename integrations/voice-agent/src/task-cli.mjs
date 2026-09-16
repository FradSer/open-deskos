#!/usr/bin/env node
import { loadTaskConfig } from './task-store.mjs';
import { readFrame, requestTask, REQUEST_LIMIT } from './task-protocol.mjs';

const deadline = setTimeout(() => { process.stderr.write('任务请求超时，结果未知；请使用原任务 ID 查询\n'); process.exit(1); }, 9000);
try {
  const request = await readFrame(process.stdin, REQUEST_LIMIT);
  process.stdin.pause();
  const config = await loadTaskConfig();
  const response = await requestTask(config.socketPath, request);
  if (response?.version !== 1 || response?.requestId !== request?.requestId || typeof response?.ok !== 'boolean') throw new Error('任务响应无效');
  process.stdout.write(`${JSON.stringify(response)}\n`);
} catch {
  process.stderr.write('任务通信失败，执行结果未知；请使用原任务 ID 查询\n');
  process.exitCode = 1;
} finally { clearTimeout(deadline); process.stdin.destroy(); }
