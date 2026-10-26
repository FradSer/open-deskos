import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const [build, destination] = process.argv.slice(2)
if (!build || !destination) throw Error('Usage: node bundle.mjs BUILD_DIRECTORY NEW_BUNDLE_DIRECTORY')
const files = [['bootloader/bootloader.bin','0x0'],['partition_table/partition-table.bin','0x8000'],['odk_c6_gateway.bin','0x10000']]
const description = JSON.parse(fs.readFileSync(path.join(build, 'project_description.json'), 'utf8'))
if (description.target !== 'esp32c6' || description.git_revision !== 'v5.5.4') throw Error('Expected ESP32-C6 build with ESP-IDF v5.5.4')
fs.mkdirSync(destination)
const plan = { board: 'm5stack-nanoc6', chip: 'esp32c6', firmware: '0.1.0', sourceRevision: description.project_version, toolchain: `ESP-IDF ${description.git_revision}`, files: [] }
for (const [relative, address] of files) {
  const bytes = fs.readFileSync(path.join(build, relative))
  const name = path.basename(relative)
  fs.writeFileSync(path.join(destination, name), bytes)
  plan.files.push({ name, address, sha256: crypto.createHash('sha256').update(bytes).digest('hex') })
}
fs.writeFileSync(path.join(destination,'firmware.json'), JSON.stringify(plan, null, 2) + '\n')
console.log(JSON.stringify(plan))
