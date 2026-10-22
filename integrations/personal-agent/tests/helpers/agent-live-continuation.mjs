import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createExperienceStore } from '../../src/agent-plugins/experience.mjs'
import { readProactiveFile } from '../../src/proactive-private.mjs'

/** Snapshot accepted synthetic learning only; a failed later stage is not rewritten as passed. */
export async function loadLiveContinuation(directory) {
  const root = resolve(directory)
  if (await realpath(root) !== root) throw Error('Continuation evidence path is unavailable')
  const raw = readProactiveFile(join(root, 'report.json'), 262144)
  const report = JSON.parse(raw)
  const training = report.taskChecks?.find(task => task.phase === 'saved-training')
  const artifact = report.acceptedExperience
  if (report.realModel !== true || report.realJev !== true || report.offlineFixture !== false || report.syntheticData !== true
    || report.sourceUnchanged !== true || report.cleanupPassed !== true || report.hostValidationRequired !== true
    || !/^[a-f0-9]{40}$/.test(report.candidate)
    || training?.state !== 'finished' || training.verification !== 'passed' || training.learning !== 'applied'
    || training.score?.expected !== 6 || training.score.actual !== 6 || training.score.passed !== true
    || artifact?.file !== 'accepted-experience.json' || !Number.isSafeInteger(artifact.entries) || artifact.entries < 1 || artifact.entries > 4
    || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw Error('Continuation training evidence is insufficient')
  const file = join(root, artifact.file), experience = createExperienceStore(file).load()
  const content = readProactiveFile(file, 65536)
  if (experience.entries.length !== artifact.entries || JSON.stringify(experience) !== JSON.stringify(JSON.parse(content))
    || createHash('sha256').update(content).digest('hex') !== artifact.sha256) throw Error('Continuation experience does not match its evidence')
  return { experience, source: { report: join(root, 'report.json'), reportSha256: createHash('sha256').update(raw).digest('hex'), experienceSha256: artifact.sha256, candidate: report.candidate } }
}
