const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const service = fs.readFileSync('face-agent/systemd/open-deskos-face-agent.service', 'utf8')
const installer = fs.readFileSync('scripts/cm5-install.sh', 'utf8')

test('defines a restartable user service for the installed Face Agent', () => {
  assert.match(service, /^Description=Open DeskOS Face Agent$/m)
  assert.match(service, /^ExecStart=\/opt\/face-agent-venv\/bin\/python3 \/opt\/face-agent\/face_service\.py$/m)
  assert.match(service, /^Restart=always$/m)
  assert.match(service, /^RestartSec=3$/m)
})

test('provisions local Face Agent dependencies and enables it before kiosk autostart', () => {
  assert.match(installer, /FACE_AGENT_DIR="\/opt\/face-agent"/)
  assert.match(installer, /python3-venv python3-opencv python3-aiohttp python3-numpy/)
  assert.match(service, /Environment=FACE_AGENT_DEVICE=\/dev\/open-deskos-p4-camera/)
  assert.match(service, /Environment=FACE_AGENT_WIDTH=1280/)
  assert.match(service, /Environment=FACE_AGENT_HEIGHT=720/)
  assert.match(service, /Environment=FACE_AGENT_FPS=30/)
  assert.match(installer, /python3-venv python3-opencv python3-aiohttp python3-numpy python3-serial/)
  assert.match(installer, /python3 -m venv --system-site-packages "\$\{FACE_AGENT_VENV\}"/)
  assert.match(installer, /"\$\{FACE_AGENT_VENV\}\/bin\/pip" install --upgrade pyserial onnxruntime opencv-contrib-python-headless/)
  assert.match(installer, /99-open-deskos-p4-camera\.rules/)
  assert.match(installer, /SYMLINK\+="open-deskos-p4-camera"/)
  assert.match(installer, /install -o root -g root -m 0644 face-agent\/face_service\.py/)
  assert.match(installer, /open-deskos-face-agent\.service/)

  const serviceEnable = installer.indexOf('enable --now open-deskos-face-agent.service')
  const kioskAutostart = installer.indexOf('== registering kiosk autostart ==')
  assert.ok(serviceEnable >= 0)
  assert.ok(serviceEnable < kioskAutostart)
})
