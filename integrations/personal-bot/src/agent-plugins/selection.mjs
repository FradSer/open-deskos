const PLUGINS = Object.freeze(['experience', 'completion', 'learning', 'catalog', 'mcp', 'subagents', 'intent', 'remote_conversation'])

/** Select reviewed DeskOS implementations, never native extension packages or paths. */
export function validateAgentPlugins(value = { enabled: [] }) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['enabled', 'autoLearn'].includes(key))
    || !Array.isArray(value.enabled) || value.enabled.some(id => !PLUGINS.includes(id))
    || new Set(value.enabled).size !== value.enabled.length || (value.autoLearn !== undefined && typeof value.autoLearn !== 'boolean')
    || (value.enabled.includes('remote_conversation') && !value.enabled.includes('completion'))
    || (value.enabled.includes('learning') && !value.enabled.includes('completion'))
    || (value.enabled.includes('mcp') && !value.enabled.includes('catalog'))) throw Error('Invalid Open DeskOS agent plugin selection')
  return { enabled: [...value.enabled], autoLearn: value.autoLearn ?? true }
}
