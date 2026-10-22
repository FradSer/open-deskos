import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadTaskConfig } from './task-store.mjs';
import { createTaskService } from './task-service.mjs';
import { createHostedSession, readHostedHistory } from './task-agent.mjs';
import { serveTasks } from './task-protocol.mjs';
import { endpointFile, publishEndpoint, removeEndpoint } from './task-endpoint.mjs';
import { createTaskComposition } from './task-composition.mjs';
import { loadHostedPiReplacements } from './development-plugins.mjs';
import { loadPersonalAgentPluginConfig, loadPersonalAgentManagementModules } from './plugin-composition.mjs';

/** @param {import('./task-store.mjs').TaskConfig} config */
export function createTaskDaemon(config, { replacementPlugins = [], disabled = [], control = undefined } = {}) {
  if (control === undefined) {
    const host = loadPersonalAgentManagementModules().resolveShellHost();
    const endpoint = host.endpoint('hosted-pi-control');
    control = endpoint ? { endpoint, stateDir: host.stateDir, platform: host.platform } : undefined;
  }
  const composition = createTaskComposition({
    replacementPlugins, disabled, control,
    openChannel: (handle, disconnect) => serveTasks(config.socketPath, handle, disconnect),
    createService: () => createTaskService(config, { createSession: createHostedSession, readHistory: readHostedHistory }),
    endpointFile,
    publishEndpoint: file => publishEndpoint(file, config),
    removeEndpoint,
    reportPublicationFailure: () => process.stderr.write('Hosted Pi 已启动，但端点描述符未能发布，Console 控制将不可用\n'),
  });
  return {
    async start() { process.umask(0o077); await composition.start(); },
    async close() { await composition.close(); },
    pluginCatalog: () => composition.catalog(),
  };
}

/** @param {import('./task-store.mjs').TaskConfig} config */
export async function startTaskDaemon(config) {
  const daemon = createTaskDaemon(config);
  await daemon.start();
  return { close: daemon.close, pluginCatalog: daemon.pluginCatalog };
}

/**
 * Node resolves symlinks before setting import.meta.url, so a service started through a stable
 * `/opt/odk/current` symlink would compare a real path against a symlinked argv[1], skip
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
    const { values } = parseArgs({ options: {
      'plugin-selection': { type: 'string' }, 'trust-plugins': { type: 'boolean', default: false },
      plugins: { type: 'string' },
    } });
    if (values.plugins && !['list', 'validate'].includes(values.plugins)) throw Error('invalid Hosted Pi inspection command');
    if (values['trust-plugins'] && !values['plugin-selection']) throw Error('Hosted Pi trust requires a startup selection');
    const replacementPlugins = values['plugin-selection']
      ? loadHostedPiReplacements(values['plugin-selection'], { trusted: values['trust-plugins'] }) : [];
    const disabled = loadPersonalAgentPluginConfig().resolveStartupDisabled(process.env);
    if (values.plugins) {
      const unavailable = () => { throw Error('inspection must not start providers'); };
      const inspection = createTaskComposition({ replacementPlugins, disabled,
        openChannel: unavailable, createService: unavailable, endpointFile: () => null,
        publishEndpoint: unavailable, removeEndpoint: unavailable,
      });
      inspection.validate();
      console.info(JSON.stringify({ host: 'personal-agent', instance: 'hosted-pi', scope: 'declarations',
        validated: values.plugins === 'validate', plugins: inspection.catalog() }));
    } else {
      const daemon = createTaskDaemon(await loadTaskConfig(), { replacementPlugins, disabled });
      let closing = false;
      const shutdown = () => {
        if (closing) return;
        closing = true;
        const deadline = setTimeout(() => process.exit(1), 10000);
        daemon.close().then(() => { clearTimeout(deadline); }, () => process.exit(1));
      };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
      await daemon.start();
    }
  } catch { process.stderr.write('任务服务启动失败，请检查本机配置\n'); process.exitCode = 1; }
}
