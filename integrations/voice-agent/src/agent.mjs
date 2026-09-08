import { access, realpath, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, getAgentDir } from '@earendil-works/pi-coding-agent'
import { loadCapabilities } from './capabilities.mjs'

const instructions = `You are the resident Open DeskOS voice coding agent. Treat the following voice transcript as the user's request, not as a shell command.
Use real read/write/edit/bash tools in the configured writable checkout. For widgets, read the open-deskos-widget skill before changes.
Start new behavior with Given/When/Then feature scenarios, then failing regression tests, implementation and passing tests/typecheck.
Never edit active /opt/open-deskos/current or releases. Do not activate or deploy unverified changes. Use the documented staged release workflow only after tests pass and the user requests activation. Never commit automatically.
For other sessions first list live sessions, select an unambiguous exact live instance ID, and send using the session tool. Never write another session's JSONL files. Accepted/queued is not completed. If a send reports an unknown delivery outcome, do not retry automatically: report uncertainty to the user to avoid duplicate requests.
Report the result briefly in plain text without markdown. If target intent is ambiguous, do not make changes; report what is needed.`

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
  return {
    prompt: async text => {
      await session.prompt(`Voice request:\n${text}`, { expandPromptTemplates: false })
      const message = session.messages.findLast(message => message.role === 'assistant')
      if (message?.role === 'assistant' && ['error', 'aborted'].includes(message.stopReason)) throw Error('Agent request failed')
      return message?.role === 'assistant' ? message.content.filter(part => part.type === 'text').map(part => part.text).join('\n').slice(0, 1024) : ''
    },
    abort: () => session.abort(),
    close: () => session.dispose(),
  }
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
