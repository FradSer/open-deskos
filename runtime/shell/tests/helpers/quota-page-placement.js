'use strict'

// The shipped desktop layout places no Usage page, because the App is reachable
// only from its Home Widget. A page-surface harness therefore puts that page
// back before the Shell composes the desktop, and both page harnesses inject the
// same self-contained source for it.
const quotaPagePlacementSource = `(() => {
  let layout;
  Object.defineProperty(window, 'DESKTOP_LAYOUT', { configurable: true, get: () => layout, set(value) {
    layout = value;
    if (layout?.pages && !layout.pages.some(page => page.plugin === 'odk.page.quota')) {
      layout.pages.push({ id: 'quota', name: 'Usage', kind: 'page', surface: 'app', plugin: 'odk.page.quota' });
    }
  }});
})();`

module.exports = { quotaPagePlacementSource }
