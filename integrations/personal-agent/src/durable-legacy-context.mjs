import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { defineDoc } from '@earendil-works/pi-durable'
import { convertToLlm } from '@earendil-works/pi-coding-agent'
import { transformMessages } from '@earendil-works/pi-ai/api/transform-messages'

const LegacyContext = defineDoc({
  kind: 'odk.legacy-context', version: 1, scope: 'conversation', history: 'latest', fork: 'current', checkpointWhen: () => true,
  initial: /** @returns {{completed: boolean, source: string}} */ () => ({ completed: false, source: '' }),
})

/** Import inert model history once. Never create submissions, tasks, or grants.
 * @param {import('@earendil-works/pi-durable').Conversation} conversation
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} manager
 * @param {import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>} model
 */
export async function importLegacyContext(conversation, manager, model) {
  await conversation.commit(async tx => {
    // Table reads must precede document creation and transcript writes.
    const existing = await tx.scanEntries({ conversationId: conversation.id }, 1)
    const checkpoint = await tx.doc(LegacyContext, conversation.id)
    if (checkpoint.completed) return
    if (existing.items.length === 0 && manager) {
      const projected = convertToLlm(manager.buildSessionProjection().messages).filter(message => message.role !== 'system')
      // Pi supplies explicit error results for historical calls without results.
      // They are context only; neither successful nor interrupted calls execute.
      const messages = transformMessages(projected, model)
      if (messages.length) {
        await tx.appendEntry(conversation.id, { kind: 'odk.legacy-context', model: messages })
        checkpoint.source = manager.getSessionId()
      }
    }
    checkpoint.completed = true
  }, BACKGROUND_CONTEXT)
}
