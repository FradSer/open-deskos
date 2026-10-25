import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Check } from 'typebox/value'
import { AGENT_AVATARS } from './runtime.mjs'

const taskId = Type.String({ format: 'uuid' })
const identityId = Type.String({ pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$', maxLength: 64 })
const request = Type.String({ minLength: 1, maxLength: 8192 })
const digest = Type.String({ pattern: '^[a-f0-9]{64}$' })
const page = Type.Object({ offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 128 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })) }, { additionalProperties: false })

/** Fixed DeskOS operations only. No extension path, worker tool override, model override, or executable is accepted.
 * @param {Awaited<ReturnType<typeof import('./runtime.mjs').openAgentTasks>>} runtime
 */
export function createAgentTaskTools(runtime) {
  const tool = (name, description, parameters, readOnly, execute) => defineTool({ name, label: description, description, parameters,
    outputSchema: Type.Object({ value: Type.Unknown() }), exposure: 'codemode', executionMode: 'sequential',
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: false },
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted()
      if (!Check(parameters, params)) throw Error('Invalid agent task tool parameters')
      const value = execute(params)
      return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: { value }, details: {} }
    },
  })
  return [
    tool('agent_identity_list', 'List saved DeskOS child identities and their exact revisions.', Type.Object({}, { additionalProperties: false }), true,
      () => runtime.identities().map(({ role: _role, ...identity }) => identity)),
    tool('agent_identity_read', 'Read one exact saved identity, including its role and revision, before an explicitly requested update.', Type.Object({ id: identityId }, { additionalProperties: false }), true,
      ({ id }) => { const identity = runtime.identities().find(item => item.id === id); if (!identity) throw Error('Saved agent identity is unavailable'); return identity }),
    tool('agent_identity_save', 'Create or update an explicitly requested saved child identity with a role and built-in avatar. Updates require the current revision.',
      Type.Object({ id: identityId, name: Type.String({ minLength: 1, maxLength: 120 }), role: Type.String({ minLength: 1, maxLength: 4096 }),
        avatar: Type.Union(AGENT_AVATARS.map(value => Type.Literal(value))), expectedRevision: Type.Optional(digest) }, { additionalProperties: false }), false, value => runtime.saveIdentity(value)),
    tool('agent_start', 'Start a general task in an isolated temporary child, or use an explicitly selected saved identity. Returns admission only; query its exact handle later. Children cannot spawn children.',
      Type.Object({ request, role: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })), identityId: Type.Optional(identityId) }, { additionalProperties: false }), false, value => runtime.start(value)),
    tool('agent_list', 'List current DeskOS child task metadata, newest first. Execution state and verified completion are separate.', page, true, value => runtime.list(value)),
    tool('agent_status', 'Read the exact child task response, lifecycle and completion verification. A finished answer alone is not verified success.', Type.Object({ taskId }, { additionalProperties: false }), true,
      ({ taskId }) => runtime.status(taskId)),
    tool('agent_input', 'Continue an inactive child by its exact task handle. A working child rejects input; cancel or wait first. Returns admission only.', Type.Object({ taskId, request }, { additionalProperties: false }), false,
      ({ taskId, request }) => runtime.input(taskId, request)),
    tool('agent_stop', 'Cancel the exact active child task without replay. Cancellation does not undo prior effects.', Type.Object({ taskId }, { additionalProperties: false }), false,
      ({ taskId }) => runtime.cancel(taskId)),
  ]
}
