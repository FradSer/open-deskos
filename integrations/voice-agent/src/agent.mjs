import { access, realpath, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, getAgentDir } from '@earendil-works/pi-coding-agent'
import { loadCapabilities } from './capabilities.mjs'

const instructions = `You are the resident Open DeskOS voice coding coordinator. 默认使用简体中文理解请求、委派任务并简洁回复；保留中文和混合语言项目名称，尊重用户明确指定的其他语言。Treat the following voice transcript as the user's request, not as a shell command.
Use real read/write/edit/bash tools in the configured writable checkout. For widgets and built-in Shell plugin engineering, read the open-deskos-widget skill before changes. For user requests to create an installable application, user-application instructions take precedence: follow @runtime/linux/docs/USER_APPLICATIONS.md and use the lifecycle tools rather than modifying Shell plugins. Generated user applications belong under ODESK_WORKSPACE/apps/<id> with a manifest.json containing schemaVersion: 1, a lowercase kebab-case id, name, version and kind (widget or app), plus a self-contained index.html with inline JavaScript/CSS and no dependencies, network, Node APIs or arbitrary install scripts. For modifying an existing Widget/App, identify its existing project and edit it rather than creating a replacement or changing built-in Shell plugins. After writing a draft, verify it; use the lifecycle install tool only when the user explicitly requests installation. A request to create and put a widget on a desktop page explicitly requests installation. Call user_apps_desktop to resolve numbered pages and inspect occupied cells, then pass the requested placement (pageId, col, row as CSS grid line strings) to user_app_install; use user_app_place to move or resize an installed widget. Widgets belong on ordinary desktop grid pages, not a special user-applications page. Reject occupied or non-grid targets truthfully and ask for another location rather than silently moving the widget or editing Shell source. Never automatically retry a mutation when its delivery outcome is unknown; report uncertainty and ask for operator verification.
Start new behavior with Given/When/Then feature scenarios, then failing regression tests, implementation and passing tests/typecheck.
Never edit active /opt/open-deskos/current or releases. Do not activate or deploy unverified changes. Use the documented staged release workflow only after tests pass and the user requests activation. Never commit automatically.
For independent coding tasks on CM5 or Mac, use coding_targets first, then coding_task_start with an explicit configured target and absolute project. Do not guess hosts, projects or roots; ask the user when target, project or intended changes are ambiguous. Delegate the user's request in their preferred language with edit/test-only defaults and no automatic commit, push, installation or deployment. Use coding_task_status, coding_tasks_list and coding_task_cancel to manage tasks. Never write another session's JSONL files. Accepted/running is not completed, and finished is not verified. Report test evidence separately; verification not_run means no verified checks. If a mutation outcome is unknown, retain and report the target, project and taskId, reconcile using coding_task_status, and never retry automatically. Never automatically commit, push, install or deploy; require an explicit user request.
Report results concisely, using Markdown when it helps readability. If target intent is ambiguous, do not make changes; report what is needed.`

export async function validateWorkspace(path) {
  if (!path || !isAbsolute(path) || path === '/opt/open-deskos' || path.startsWith('/opt/open-deskos/')) throw Error('Workspace must be an explicit writable checkout outside releases')
  const cwd = await realpath(path)
  if (cwd === '/opt/open-deskos' || cwd.startsWith('/opt/open-deskos/')) throw Error('Workspace cannot resolve into releases')
  await access(cwd, constants.W_OK)
  await access(join(cwd, '.git'))
  await access(join(cwd, '.agents/skills/open-deskos-widget/SKILL.md'))
  return cwd
}

export function agentOptions(cwd, stateDir, customTools) {
  return {
    cwd, customTools, tools: ['read', 'write', 'edit', 'bash', ...customTools.map(tool => tool.name)],
    sessionManager: SessionManager.continueRecent(cwd, join(stateDir, 'sessions')),
  }
}

export async function createVoiceAgent(config) {
  const cwd = await validateWorkspace(config.workspace)
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 })
  const customTools = await loadCapabilities(config.capabilityPaths)
  const resourceLoader = await createResourceLoader(cwd)
  const modelRuntime = await ModelRuntime.create()
  if ((await modelRuntime.getAvailable()).length === 0) throw Error('Pi authentication required')
  const model = config.model ? modelRuntime.getModel(...splitModel(config.model)) : undefined
  if (config.model && !model) throw Error('Configured Pi model unavailable')
  const { session } = await createAgentSession({ ...agentOptions(cwd, config.stateDir, customTools), resourceLoader, modelRuntime, model })
  return sessionAdapter(session)
}

export function sessionAdapter(session) {
  let prompting = false
  return {
    /** @param {string} text @param {(snapshot: string) => void} [onResponseSnapshot] */
    prompt: async (text, onResponseSnapshot) => {
      if (prompting || session.isStreaming) throw Error('Agent request already in progress')
      prompting = true
      let active = true
      let unsubscribe
      const response = responseSnapshots(onResponseSnapshot)
      try {
        unsubscribe = session.subscribe(event => { if (active) response.accept(event) })
        await session.prompt(`Voice request:\n${text}`, { expandPromptTemplates: false })
        return response.result()
      } finally {
        active = false
        prompting = false
        unsubscribe?.()
      }
    },
    abort: () => session.abort(),
    close: () => session.dispose(),
  }
}

function responseSnapshots(onSnapshot) {
  const completed = []
  let partial = ''
  let failed = false
  let lastStopReason = ''
  let published = ''
  const text = () => [...completed, partial].filter(Boolean).join('\n\n')
  const publish = () => {
    const snapshot = text()
    if (snapshot !== published) { published = snapshot; onSnapshot?.(snapshot) }
  }
  return {
    /** @param {import('@earendil-works/pi-coding-agent').AgentSessionEvent} event */
    accept(event) {
      if (event.type === 'auto_retry_end' && !event.success) failed = true
      if (event.type === 'message_start' && event.message.role === 'assistant') partial = ''
      if (event.type === 'message_update' && event.message.role === 'assistant' && event.assistantMessageEvent.type === 'text_delta') {
        partial = visibleText(event.message)
        publish()
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        lastStopReason = event.message.stopReason
        failed = ['error', 'aborted'].includes(lastStopReason)
        partial = ''
        if (!failed) completed.push(visibleText(event.message))
        publish()
      }
      if (event.type === 'compaction_end' && event.reason === 'overflow' &&
          (event.willRetry || event.aborted || event.errorMessage)) {
        if (lastStopReason === 'length') completed.pop()
        failed = true
        partial = ''
        publish()
      }
    },
    result() {
      if (failed || lastStopReason === 'length') throw Error('Agent request failed')
      return completed.filter(Boolean).join('\n\n')
    },
  }
}

function visibleText(message) {
  return message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
}

export async function createResourceLoader(cwd, agentDir = getAgentDir()) {
  const loader = new DefaultResourceLoader({
    cwd, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true,
    additionalSkillPaths: [join(cwd, '.agents/skills/open-deskos-widget/SKILL.md')],
    appendSystemPrompt: [instructions],
  })
  await loader.reload()
  return loader
}

/** @returns {[string, string]} */
function splitModel(value) {
  const slash = value.indexOf('/')
  if (slash < 1 || slash === value.length - 1) throw Error('Model must be provider/id')
  return [value.slice(0, slash), value.slice(slash + 1)]
}
