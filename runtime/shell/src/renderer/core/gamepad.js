;
// The owner's gamepad, read in the Shell so that one host's pad costs another
// host nothing. Xbox-style pads present the same standard mapping on Windows and
// on Linux, so one table carries the physical controls onto the desk's own
// navigation intents: the directional pad moves, A confirms, B cancels, the
// shoulders change page, and Y summons voice through the microphone intent the
// Remote Control's MIC already produces. A pad is not the Remote Control and
// this module never names it so.
(function (root) {
  'use strict'

  // Directions repeat while held because a pad has no keyboard auto-repeat and
  // holding a direction is how a list is walked on a handheld.
  const REPEAT_DELAY_MS = 450
  const REPEAT_INTERVAL_MS = 130

  const BUTTON_INTENTS = [
    [0, 'primary'], // A confirms
    [1, 'back'], // B cancels
    [3, 'mic'], // Y summons voice
    [4, 'page-previous'], // LB
    [5, 'page-next'], // RB
    [12, 'up'],
    [13, 'down'],
    [14, 'left'],
    [15, 'right'],
  ]
  const REPEATING = new Set(['up', 'down', 'left', 'right'])

  const ABSENT = { connected: false, id: null, readable: false }

  function connectedPads(read) {
    const pads = read() || []
    return Array.from(pads).filter((pad) => pad && pad.connected !== false)
  }

  // A pad the desk cannot read is still a connected pad it must state, but it
  // drives nothing: an unreadable pad early in the list never hides a readable
  // one later in it.
  function readablePad(pads) {
    return pads.find((pad) => pad.mapping === 'standard') || null
  }

  function stateOf(pads) {
    const pad = readablePad(pads) || pads[0]
    if (!pad) return ABSENT
    return { connected: true, id: pad.id || null, readable: pad.mapping === 'standard' }
  }

  function createGamepadInput(options) {
    const settings = options || {}
    const source = typeof settings.read === 'function' ? settings.read : () => root.navigator?.getGamepads?.() || []
    const emit = typeof settings.onInput === 'function' ? settings.onInput : () => {}
    const announce = typeof settings.onConnection === 'function' ? settings.onConnection : () => {}
    const now = typeof settings.now === 'function' ? settings.now : () => Date.now()
    const held = new Map()
    let announced = null

    function poll() {
      const pads = connectedPads(source)
      const state = stateOf(pads)
      if (announced === null || announced.connected !== state.connected || announced.id !== state.id || announced.readable !== state.readable) {
        announced = state
        announce({ ...state })
      }
      const buttons = readablePad(pads)?.buttons || []
      const at = now()
      for (const [index, intent] of BUTTON_INTENTS) {
        if (!buttons[index]?.pressed) {
          held.delete(index)
          continue
        }
        const entry = held.get(index)
        if (entry === undefined) {
          held.set(index, { nextRepeatAt: at + REPEAT_DELAY_MS })
          emit(intent)
          continue
        }
        if (!REPEATING.has(intent) || at < entry.nextRepeatAt) continue
        entry.nextRepeatAt = at + REPEAT_INTERVAL_MS
        emit(intent)
      }
    }

    return {
      poll,
      connection: () => announced || { ...ABSENT },
    }
  }

  root.odkGamepadInput = { createGamepadInput, BUTTON_INTENTS, REPEAT_DELAY_MS, REPEAT_INTERVAL_MS }
})(typeof window !== 'undefined' ? window : globalThis)