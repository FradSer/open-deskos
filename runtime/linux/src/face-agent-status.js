const FACE_AGENT_STATUS_URL = 'http://127.0.0.1:8790/status'
const FACE_AGENT_TIMEOUT_MS = 1500

const EMOTION_KEYS = new Set([
  'neutral', 'happiness', 'surprise', 'sadness',
  'anger', 'disgust', 'fear', 'contempt',
])
const P4_ON_DEVICE_SOURCE = 'esp32p4_on_device_inference'

function validBox(box) {
  return Array.isArray(box)
    && box.length === 4
    && box.every((value) => Number.isInteger(value))
    && box[0] >= 0
    && box[1] >= 0
    && box[2] > 0
    && box[3] > 0
}

function validFace(face) {
  return Boolean(face)
    && typeof face === 'object'
    && validBox(face.box)
    && Number.isFinite(face.detect_score)
    && face.detect_score >= 0
    && face.detect_score <= 1
}

function unavailable() {
  return { state: 'unavailable', facesCount: null, emotion: null, unlocked: false }
}

function locked(state, facesCount = null, emotion = null) {
  return { state, facesCount, emotion, unlocked: false }
}

function normalizeFaceAgentStatus(payload) {
  if (!payload || typeof payload !== 'object') return unavailable()
  if (payload.status === 'starting') {
    return locked('starting')
  }
  if (payload.status === 'camera-unavailable' || payload.status === 'degraded') {
    return locked('camera-unavailable')
  }
  if (payload.status === 'no-frame') {
    return locked('no-frame')
  }
  if (payload.status !== 'online') return unavailable()

  const result = payload.latest_result
  if (result === undefined || result === null) {
    return locked('no-frame')
  }
  if (
    !result || typeof result !== 'object'
    || result.source !== P4_ON_DEVICE_SOURCE
    || result.camera_online !== true
    || !Number.isInteger(result.faces_count) || result.faces_count < 0
    || !Number.isInteger(result.current_face_index)
    || !Array.isArray(result.faces) || result.faces.length !== result.faces_count
    || !result.faces.every(validFace)
    || (result.faces_count === 0 && result.current_face_index !== -1)
    || (result.faces_count > 0 && (result.current_face_index < 0 || result.current_face_index >= result.faces_count))
  ) {
    return unavailable()
  }
  if (result.faces_count === 0) {
    return locked('no-face', 0)
  }

  const currentFace = result.faces[result.current_face_index]
  const identity = currentFace.face_id
  const unlocked = Boolean(identity?.unlocked)
    && typeof identity.user === 'string'
    && identity.user.length > 0
    && Number.isFinite(identity.similarity)
    && Number.isFinite(identity.threshold)
    && identity.similarity >= identity.threshold
  const emotion = currentFace.emotion
  const confidence = Number(emotion?.confidence)
  return {
    state: unlocked ? 'recognized' : 'unknown-face',
    facesCount: result.faces_count,
    emotion: unlocked && EMOTION_KEYS.has(emotion?.primary) && confidence >= 0 && confidence <= 1
      ? { primary: emotion.primary, confidence: Math.round(confidence * 100) }
      : null,
    unlocked,
  }
}

async function fetchFaceAgentStatus({
  fetchImpl = globalThis.fetch,
  timeoutMs = FACE_AGENT_TIMEOUT_MS,
} = {}) {
  try {
    const response = await fetchImpl(FACE_AGENT_STATUS_URL, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return unavailable()
    return normalizeFaceAgentStatus(await response.json())
  } catch {
    return unavailable()
  }
}

module.exports = {
  FACE_AGENT_STATUS_URL,
  FACE_AGENT_TIMEOUT_MS,
  fetchFaceAgentStatus,
  normalizeFaceAgentStatus,
}
