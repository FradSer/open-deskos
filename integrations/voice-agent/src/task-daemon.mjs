import { pathToFileURL } from 'node:url';
import { loadTaskConfig } from './task-store.mjs';
import { createTaskService } from './task-service.mjs';
import { runTask } from './task-agent.mjs';
import { serveTasks } from './task-protocol.mjs';

/** @param {import('./task-store.mjs').TaskConfig} config */
export async function startTaskDaemon(config) {
  process.umask(0o077);
  let service;
  const server = await serveTasks(config.socketPath, request => {
    if (!service) return Promise.resolve({ version: 1, requestId: request.requestId, ok: false, error: '任务服务正在启动' });
    return service.handle(request);
  });
  try { service = await createTaskService(config, { runTask }); }
  catch (error) { await server.close(); throw error; }
  return { async close() { await server.close(); await service.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const daemon = await startTaskDaemon(await loadTaskConfig());
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      const deadline = setTimeout(() => process.exit(1), 10000);
      daemon.close().then(() => { clearTimeout(deadline); }, () => process.exit(1));
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch { process.stderr.write('任务服务启动失败，请检查本机配置\n'); process.exitCode = 1; }
}
