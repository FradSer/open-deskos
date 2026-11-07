// Scores order evidence. They are neither probabilities nor authority.
const STOP = new Set('a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our should so than that the their them then there these they this those to was we were what when where which who why will with would you your 我 你 的 了 是 在 和 与 请 吗 呢 什么 怎么 如何 是否 一下'.split(' '))
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

function terms(text) {
  const normalized = text.normalize('NFKC').toLowerCase().replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+)/gu, ' $1 ')
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  const output = []
  for (const word of words) {
    if (CJK.test(word)) {
      const characters = [...word]
      for (let i = 0; i < characters.length; i++) {
        if (!STOP.has(characters[i])) output.push(characters[i])
        if (i + 1 < characters.length) output.push(characters[i] + characters[i + 1])
      }
    } else if (!STOP.has(word)) output.push(word)
  }
  return output
}

/** BM25 with title weighting, Unicode normalization, CJK character pairs, and stable ties.
 * Empty queries retain storage order for complete pagination. No query performs a write.
 * @template {{title: string, body: string}} T
 * @param {T[]} entries
 */
export function createMemoryIndex(entries) {
  const frequencies = new Map()
  const documents = entries.map(entry => {
    const title = terms(entry.title), body = terms(entry.body), counts = new Map()
    for (const token of [...title, ...title, ...body]) counts.set(token, (counts.get(token) ?? 0) + 1)
    for (const token of counts.keys()) frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
    return { entry, counts, length: title.length * 2 + body.length }
  })
  const average = documents.reduce((sum, doc) => sum + doc.length, 0) / (documents.length || 1) || 1
  return {
    /** @param {string} query @returns {T[]} */
    search(query) {
      if (!query.trim()) return [...entries]
      const tokens = [...new Set(terms(query.slice(0, 2048)))]
      if (!tokens.length) return []
      return documents.map((document, index) => {
        let score = 0
        for (const token of tokens) {
          const count = document.counts.get(token) ?? 0
          if (!count) continue
          const df = frequencies.get(token)
          const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5))
          score += idf * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * document.length / average))
        }
        return { entry: document.entry, index, score }
      }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.entry)
    },
  }
}
