import { createAvatar } from '@bible-strong/avatar-web'
import definition from './onee.avatar.json'
export const poses = Object.fromEntries(Object.entries(definition.animations).map(([key, animation]) => [key, animation.steps[0].expression]))
export function create(target, options) {
  return createAvatar(target, { ...options, definition, size: '100%', ariaLabel: 'Onee' })
}
