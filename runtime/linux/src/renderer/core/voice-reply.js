;(function () {
  'use strict'

  const markdown = window.markdownit({ html: false, linkify: false, breaks: true })
  const escape = markdown.utils.escapeHtml
  markdown.renderer.rules.link_open = (tokens, index, _options, env) => {
    env.linkUrls.push(tokens[index].attrGet('href'))
    return ''
  }
  markdown.renderer.rules.link_close = (_tokens, _index, _options, env) => ` (${escape(env.linkUrls.pop())})`
  markdown.renderer.rules.image = (tokens, index, options, env, renderer) => (
    escape(renderer.renderInlineAsText(tokens[index].children, options, env))
  )

  function isPlainText(tokens) {
    return tokens.every((token) => {
      if (token.type === 'paragraph_open' || token.type === 'paragraph_close') return true
      return token.type === 'inline'
        && token.children.every((child) => ['text', 'softbreak'].includes(child.type))
        && token.content === token.children.map((child) => child.type === 'softbreak' ? '\n' : child.content).join('')
    })
  }

  function render(target, message) {
    const env = { linkUrls: [] }
    const tokens = markdown.parse(message, env)
    const plain = isPlainText(tokens)
    target.classList.toggle('voice-status-markdown', !plain)
    if (plain) target.textContent = message
    else target.innerHTML = markdown.renderer.render(tokens, markdown.options, env)
  }

  window.odkVoiceReply = { render }
})()
