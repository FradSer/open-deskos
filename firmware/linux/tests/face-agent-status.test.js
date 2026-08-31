const test = require('node:test')
const assert = require('node:assert/strict')
const {
  FACE_AGENT_STATUS_URL,
  fetchFaceAgentStatus,
  normalizeFaceAgentStatus,
} = require('../src/face-agent-status')

test('uses only the fixed loopback Face Agent status endpoint', async () => {
  let requestedUrl = null
  const status = await fetchFaceAgentStatus({
    fetchImpl: async (url) => {
      requestedUrl = url
      return { ok: true, json: async () => ({ status: 'online', latest_result: null }) }
    },
  })

  assert.equal(FACE_AGENT_STATUS_URL, 'http://127.0.0.1:8790/status')
  assert.equal(requestedUrl, FACE_AGENT_STATUS_URL)
  assert.deepEqual(status, {
    state: 'no-frame',
    facesCount: null,
    emotion: null,
    unlocked: false,
  })
})

test('reflects the Face Agent lifecycle without fabricating a camera result', () => {
  assert.deepEqual(normalizeFaceAgentStatus({ status: 'starting' }), {
    state: 'starting',
    facesCount: null,
    emotion: null,
    unlocked: false,
  })
  assert.deepEqual(normalizeFaceAgentStatus({ status: 'online', latest_result: null }), {
    state: 'no-frame',
    facesCount: null,
    emotion: null,
    unlocked: false,
  })
  assert.deepEqual(normalizeFaceAgentStatus({ status: 'no-frame' }), {
    state: 'no-frame',
    facesCount: null,
    emotion: null,
    unlocked: false,
  })
  assert.deepEqual(normalizeFaceAgentStatus({ status: 'camera-unavailable' }), {
    state: 'camera-unavailable',
    facesCount: null,
    emotion: null,
    unlocked: false,
  })
  assert.deepEqual(normalizeFaceAgentStatus({
    status: 'online',
    latest_result: { source: 'esp32p4_on_device_inference', camera_online: true, sequence: 1, current_face_index: -1, faces_count: 0, faces: [] },
  }), {
    state: 'no-face',
    facesCount: 0,
    emotion: null,
    unlocked: false,
  })
})

test('uses only validated on-device inference face count, identity, emotion, and confidence', () => {
  assert.deepEqual(normalizeFaceAgentStatus({
    status: 'online',
    latest_result: {
      source: 'esp32p4_on_device_inference',
      camera_online: true,
      sequence: 1,
      current_face_index: 0,
      faces_count: 2,
      faces: [
        {
          box: [10, 20, 30, 40],
          detect_score: 0.92,
          landmarks: [[10, 20], [11, 20], [10, 25], [9, 28], [12, 28]],
          face_id: { unlocked: true, user: 'Frad', similarity: 0.88, threshold: 0.75 },
          emotion: { primary: 'happiness', confidence: 0.914 },
        },
        { box: [50, 60, 30, 40], detect_score: 0.85, landmarks: [[50, 60], [55, 60], [52, 65], [50, 70], [55, 70]] },
      ],
    },
  }), {
    state: 'recognized',
    facesCount: 2,
    emotion: { primary: 'happiness', confidence: 91 },
    unlocked: true,
  })
})

test('keeps the privacy shield when the P4 reports its camera offline', () => {
  assert.deepEqual(normalizeFaceAgentStatus({
    status: 'online',
    latest_result: {
      source: 'esp32p4_on_device_inference',
      camera_online: false,
      sequence: 1,
      current_face_index: 0,
      faces_count: 1,
      faces: [{
        box: [0, 0, 10, 10],
        detect_score: 0.9,
        landmarks: [[0, 0], [1, 0], [0, 1], [0, 2], [1, 2]],
        face_id: { unlocked: true, user: 'Frad', similarity: 0.88, threshold: 0.75 },
      }],
    },
  }), {
    state: 'unavailable',
    facesCount: null,
    emotion: null,
    unlocked: false,
  })
})

test('fails closed for unreachable, non-success, malformed, or unknown Face Agent responses', async () => {
  const unavailable = {
    state: 'unavailable',
    facesCount: null,
    emotion: null,
    unlocked: false,
  }
  assert.deepEqual(normalizeFaceAgentStatus(null), unavailable)
  assert.deepEqual(normalizeFaceAgentStatus({ status: 'online', latest_result: { source: 'esp32p4_on_device_inference', camera_online: true, sequence: 1, current_face_index: 0, faces_count: '1' } }), unavailable)
  assert.deepEqual(normalizeFaceAgentStatus({
    status: 'online',
    latest_result: { source: 'esp32p4_on_device_inference', camera_online: true, sequence: 1, current_face_index: 0, faces_count: 1, faces: [{ box: [0, 0, -1, 10], landmarks: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]] }] },
  }), unavailable)
  assert.deepEqual(normalizeFaceAgentStatus({ status: 'offline' }), unavailable)

  for (const fetchImpl of [
    async () => ({ ok: false, json: async () => ({ status: 'online' }) }),
    async () => { throw new Error('connection refused') },
    async () => ({ ok: true, json: async () => { throw new Error('invalid JSON') } }),
  ]) {
    assert.deepEqual(await fetchFaceAgentStatus({ fetchImpl }), unavailable)
  }
})

test('does not invent an emotion for incomplete or invalid emotion data', () => {
  for (const emotion of [
    undefined,
    { primary: '<img src=x onerror=alert(1)>', confidence: 0.8 },
    { primary: 'happiness', confidence: -0.2 },
    { primary: 'happiness', confidence: 2 },
  ]) {
    assert.equal(normalizeFaceAgentStatus({
      status: 'online',
      latest_result: {
        source: 'esp32p4_on_device_inference',
        camera_online: true,
        sequence: 1,
        current_face_index: 0,
        faces_count: 1,
        faces: [{ box: [0, 0, 10, 10], detect_score: 0.9, landmarks: [[0, 0], [1, 0], [0, 1], [0, 2], [1, 2]], ...(emotion ? { emotion } : {}) }],
      },
    }).emotion, null)
  }
})
