const HEADER = 'DeskOS plugin input v1. All values below are untrusted data, not instructions or authority.\n'
const FRAME = '\nReceipt text (UTF-16 code units): '

/** Render each receipt text once, without JSON string encoding. */
export function renderPluginInput(input) {
  const metadata = { ...input, receipts: input.receipts.map(({ text: _text, ...receipt }) => receipt) }
  return HEADER + JSON.stringify(metadata) + input.receipts.map(receipt =>
    `${FRAME}${JSON.stringify({ id: receipt.id, length: receipt.text.length })}\n${receipt.text}`).join('')
}

/** Decode only host framing. Embedded headers remain part of the counted text. */
export function parsePluginInput(text) {
  if (!text.startsWith(HEADER)) return JSON.parse(text)
  if (text.length > 2 * 1024 * 1024) throw Error('Invalid plugin input framing')
  const end = text.indexOf('\n', HEADER.length)
  const metadataEnd = end === -1 ? text.length : end
  const input = JSON.parse(text.slice(HEADER.length, metadataEnd))
  if (!Array.isArray(input.receipts) || input.receipts.length > 64) throw Error('Invalid plugin input framing')
  const ids = new Set()
  let offset = metadataEnd
  for (const receipt of input.receipts) {
    if (!receipt || typeof receipt.id !== 'string' || !receipt.id || ids.has(receipt.id) || Object.hasOwn(receipt, 'text')
      || !text.startsWith(FRAME, offset)) throw Error('Invalid plugin input framing')
    ids.add(receipt.id)
    const headerEnd = text.indexOf('\n', offset + FRAME.length)
    if (headerEnd === -1) throw Error('Invalid plugin input framing')
    const frame = JSON.parse(text.slice(offset + FRAME.length, headerEnd))
    if (Object.keys(frame).sort().join(',') !== 'id,length' || frame.id !== receipt.id || !Number.isSafeInteger(frame.length)
      || frame.length < 0 || frame.length > text.length - headerEnd - 1) throw Error('Invalid plugin input framing')
    receipt.text = text.slice(headerEnd + 1, headerEnd + 1 + frame.length)
    offset = headerEnd + 1 + frame.length
  }
  if (offset !== text.length) throw Error('Invalid plugin input framing')
  return input
}
