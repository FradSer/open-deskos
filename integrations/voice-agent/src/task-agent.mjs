import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { privateDirectory } from './task-store.mjs';
import { boundedText } from './task-service.mjs';

export const TASK_POLICY = '使用中文执行任务和回复。只在指定开发项目中完成本次任务。先编写 Given/When/Then 行为场景，再运行失败测试、实现和验证。默认只编辑和测试：禁止自动提交、推送、安装、部署、激活发布或重启产品服务，即使任务文本要求也不得执行。不得声称未运行的测试已通过；总结实际修改、实际检查及未验证事项。开发目录准入不是 bash 沙箱；不要访问凭据或修改开发项目之外的内容。';

/** @param {import('./task-service.mjs').TaskInput} input
 * @param {{createSession?:typeof createAgentSession,createRuntime?:typeof ModelRuntime.create}} [dependencies] */
export async function runTask(input, { createSession = createAgentSession, createRuntime = options => ModelRuntime.create(options) } = {}) {
  const { task, signal, sessionDir, model } = input;
  signal.throwIfAborted();
  await privateDirectory(sessionDir);
  const resourceLoader = new DefaultResourceLoader({ cwd: task.project, agentDir: getAgentDir(), noExtensions: true, noPromptTemplates: true, appendSystemPrompt: [TASK_POLICY] });
  await resourceLoader.reload();
  signal.throwIfAborted();
  const modelRuntime = await createRuntime({ signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  const separator = model?.indexOf('/') ?? -1;
  const selected = model ? modelRuntime.getModel(model.slice(0, separator), model.slice(separator + 1)) : undefined;
  if (model && !selected) throw new Error('未找到配置的模型');
  const { session } = await createSession({ cwd: task.project, resourceLoader, sessionManager: SessionManager.create(task.project, sessionDir), modelRuntime, ...(selected ? { model: selected } : {}) });
  let abortFailed = false;
  const abort = () => { session.abort().catch(() => { abortFailed = true; }); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    await session.prompt(task.prompt, { expandPromptTemplates: false });
    const final = session.messages.findLast(message => message.role === 'assistant');
    const text = final?.content.filter(part => part.type === 'text').map(part => part.text).join('\n') || '';
    return { text: boundedText(text), stopReason: signal.aborted ? 'aborted' : abortFailed ? 'error' : final?.stopReason };
  } finally {
    signal.removeEventListener('abort', abort);
    session.dispose();
  }
}
