// Run by the installer before the resident task starts. On Windows the installer
// can restrict an administrator-owned legacy directory before the limited task
// reads it; startup also retains the same migration for private user installations.
import { migratePersonalBotState } from './personal-bot-migration.mjs'

try {
  await migratePersonalBotState()
  console.log('Personal Bot state migration complete')
} catch {
  console.error('Personal Bot state migration failed; check private state ownership and destination before starting the service')
  process.exitCode = 1
}
