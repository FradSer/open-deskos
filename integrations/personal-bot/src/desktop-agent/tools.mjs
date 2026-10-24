import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Check } from 'typebox/value'

const uuid = Type.String({ format: 'uuid' })
const task = { taskId: uuid }
const schema = properties => Type.Object(properties, { additionalProperties: false })

/** Fixed task-level delegation. No image, input, shell, or private intervention control. */
export function createDesktopAgentTools(client) {
  const tool = (name, method, description, parameters, readOnly, admissionOnly = false) => defineTool({
    name, label: name, description,
    namespace: { name: 'desktop', description: 'Delegate tasks to the independent isolated desktop agent.' },
    exposure: 'codemode', executionMode: 'sequential', parameters,
    outputSchema: Type.Object({ result: Type.Record(Type.String(), Type.Unknown()), admissionOnly: Type.Boolean(), reportedOnly: Type.Literal(true) }),
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: true },
    execute: async (_id, params, signal) => {
      if (!Check(parameters, params)) throw Error('Invalid desktop task arguments')
      const result = await client.request(method, params, signal)
      const value = { result, admissionOnly, reportedOnly: true }
      return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, details: {} }
    },
  })
  return [
    tool('desktop_task_start', 'submit', 'Submit an owner-authorized task to the independent XFCE agent. Use one stable UUID requestId and retain it if delivery is unknown. desktopId is anonymous-chrome. Returns admission only; return promptly and query later. No checkout, login secrets, screenshots, input commands, or shell are exposed.',
      schema({ requestId: uuid, goal: Type.String({ minLength: 1, maxLength: 4096 }), desktopId: Type.Literal('anonymous-chrome'), constraints: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 16 })) }), false, true),
    tool('desktop_task_status', 'status', 'Read one exact desktop task lifecycle. waiting_for_user requires the separate operator interface; never solicit or send login secrets. An unknown mutation must be reconciled, never replayed.', schema(task), true),
    tool('desktop_task_result', 'result', 'Read the desktop agent reported final result, verification and evidence references. Agent-reported verification is not an independent host check. Admission, succeeded status and result prose alone do not certify completion.', schema(task), true),
    tool('desktop_task_cancel', 'cancel', 'Request cancellation of this exact task only when the owner requests it. Cancellation stops future actions and does not undo prior effects. Query status after the receipt.', schema(task), false),
    tool('desktop_task_resume', 'resume', 'Request a new attempt for an ordinary interrupted task only on owner instruction, using its observed revision. The service refuses waiting_for_user and unresolved mutations. This cannot confirm login, MFA, CAPTCHA, or any private intervention.', schema({ ...task, expectedRevision: Type.Integer({ minimum: 0 }) }), false, true),
  ]
}
