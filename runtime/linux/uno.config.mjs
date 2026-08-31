import { defineConfig, presetWind3 } from 'unocss'

const openDeskOsColors = {
  'odk-bg': 'var(--odk-bg)',
  'odk-surface': 'var(--odk-surface)',
  'odk-elevated': 'var(--odk-elevated)',
  'odk-button': 'var(--odk-button)',
  'odk-stroke': 'var(--odk-stroke)',
  'odk-stroke-focus': 'var(--odk-stroke-focus)',
  'odk-primary': 'var(--odk-primary)',
  'odk-secondary': 'var(--odk-secondary)',
  'odk-secondary-strong': 'var(--odk-secondary-strong)',
  'odk-red': 'var(--odk-accent-red)',
  'odk-green': 'var(--odk-accent-green)',
  'odk-blue': 'var(--odk-accent-blue)',
}

export default defineConfig({
  presets: [presetWind3()],
  theme: {
    colors: openDeskOsColors,
    spacing: {
      'odk-1': 'var(--odk-space-1)',
      'odk-2': 'var(--odk-space-2)',
      'odk-3': 'var(--odk-space-3)',
      'odk-4': 'var(--odk-space-4)',
    },
    borderRadius: {
      'odk-card': 'var(--odk-radius-card)',
      'odk-pill': 'var(--odk-radius-pill)',
    },
  },
  shortcuts: {
    'odk-row': 'flex flex-row',
    'odk-inline-center': 'flex items-center',
    'odk-flex-center': 'flex items-center justify-center',
    'odk-stack': 'flex flex-col',
    'odk-stack-center': 'flex flex-col items-center justify-center',
  },
  safelist: [
    'text-odk-red',
    'text-odk-green',
    'odk-row',
    'odk-inline-center',
    'odk-flex-center',
    'odk-stack',
    'odk-stack-center',
    'flex',
    'flex-col',
    'flex-row',
    'flex-wrap',
    'items-start',
    'items-center',
    'items-baseline',
    'justify-center',
    'justify-between',
  ],
})
