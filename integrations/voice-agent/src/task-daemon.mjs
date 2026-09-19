import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
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

/**
 * Node resolves symlinks before setting import.meta.url, so a service started through a stable
 * `/opt/open-deskos/current` symlink would compare a real path against a symlinked argv[1], skip
 * this block, and exit 0 without a socket or any diagnostic. Accept either form so the entry
 * point does not depend on release switching or a `--preserve-symlinks-main` flag.
 * @returns {boolean}
 */
function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  if (import.meta.url === pathToFileURL(entry).href) return true;
  try { return import.meta.url === pathToFileURL(realpathSync(entry)).href; }
  catch { return false; }
}

if (isEntryPoint()) {
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
