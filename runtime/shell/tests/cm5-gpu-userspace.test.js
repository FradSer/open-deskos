const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'cm5-gpu-userspace.sh'), 'utf8')

test('CM5 GPU userspace installer pins the firmware and userspace artifacts', () => {
  assert.match(script, /MALI_TAG="linux-6\.1-stan-rkr4"/)
  assert.match(script, /rockchip_linux_sdk_6\.1\/linux\/libmali/)
  assert.match(script, /MALI_BLOB_FILE="libmali-valhall-g610-g24p0-x11-gbm\.so"/)
  assert.match(script, /MALI_BLOB_SHA256="928ab0ae3346c06a061181445ef1afd1dcfb0c8e055491f08ffc59aeb1a8e785"/)
  assert.match(script, /MALI_FIRMWARE_FILE="mali_csffw\.bin"/)
  assert.match(script, /MALI_FIRMWARE_SHA256="60ffa376edec8c402dc0ee9357c685d835ec2e0fb3d0778f303d08a9802d57f1"/)
})

test('CM5 GPU userspace installer owns the EGL/GLES/GBM sonames and diverts Mesa', () => {
  assert.match(script, /SONAMES=\(libEGL\.so\.1 libGLESv2\.so\.2 libgbm\.so\.1\)/)
  assert.match(script, /MESA_FILES=\(libEGL\.so\.1\.1\.0 libGLESv2\.so\.2\.1\.0 libgbm\.so\.1\.0\.0\)/)
  assert.match(script, /dpkg-divert --add --rename --divert "\$\{MESA_DIVERSION_DIR\}\/\$\{file\}"/)
  assert.match(script, /dpkg-divert --remove --rename --divert "\$\{MESA_DIVERSION_DIR\}\/\$\{file\}"/)
  assert.match(script, /MESA_DIVERSION_DIR="\$\{LIB_DIR\}\/odk-mesa"/)
  assert.match(script, /ldconfig/)
  assert.match(script, /ln -sfn "\$\{MALI_BLOB_DIR\}\/\$\{MALI_BLOB_FILE\}"/)
})

test('CM5 GPU userspace installer verifies firmware, blob, soname resolution, glamor, and EGL', () => {
  assert.match(script, /glamor X acceleration enabled/)
  assert.match(script, /es2_info/)
  assert.match(script, /MISSING \/dev\/mali0/)
  assert.match(script, /checksum mismatch/)
  assert.match(script, /install\) install_all/)
  assert.match(script, /remove\) remove_all/)
  assert.match(script, /verify\) check_arch; verify_all/)
})

test('CM5 GPU userspace installer refuses non-arm64 hosts', () => {
  assert.match(script, /uname -m\)" != "aarch64"/)
})