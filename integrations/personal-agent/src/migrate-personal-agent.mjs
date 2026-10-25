// Run by the installer before the resident task starts. On Windows the installer
// can restrict an administrator-owned legacy directory before the limited task
// reads it; startup also retains the same migration for private user installations.
import { migratePersonalAgentState } from './personal-agent-migration.mjs'

try {
  await migratePersonalAgentState()
  console.log('Personal Agent state migration complete')
} catch {
  console.error('Personal Agent state migration failed; check private state ownership and destination before starting the service')
  process.exitCode = 1
}
