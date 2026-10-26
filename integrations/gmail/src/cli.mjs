import { readFile, lstat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { authorizeGmail, parseDesktopClient, revokeGmail } from './oauth.mjs'
import { readGmailCredentials, writeGmailCredentials, removeGmailCredentials, validateGmailCredentialDestination } from './credentials.mjs'

const USAGE = 'Use login --client <absolute-path> --credentials <absolute-path>, status --credentials <absolute-path>, disconnect --credentials <absolute-path>, or forget --credentials <absolute-path>.'

/** Operator-only Gmail authorization commands. */
export async function runGmailCli(argv, { output = text => process.stdout.write(`${text}\n`),
  authorize = authorizeGmail, revoke = revokeGmail, readCredentials = readGmailCredentials,
  writeCredentials = writeGmailCredentials, removeCredentials = removeGmailCredentials,
  prepareDestination = validateGmailCredentialDestination } = {}) {
  const [command, ...args] = argv
  const options = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!['--client', '--credentials'].includes(key) || options.has(key) || !value || !isAbsolute(value)) throw Error(USAGE)
    options.set(key, value)
  }
  const credentialsPath = options.get('--credentials')
  if (!credentialsPath || !['login', 'status', 'disconnect', 'forget'].includes(command)
    || (command === 'login' ? !options.has('--client') : options.has('--client'))) throw Error(USAGE)
  if (command === 'login') {
    let exists = true
    try { await lstat(credentialsPath) } catch (error) { if (error.code === 'ENOENT') exists = false; else throw Error('Could not inspect the Gmail credential path.') }
    if (exists) throw Error('Gmail credentials already exist. Disconnect before connecting another account.')
    await prepareDestination(credentialsPath)
    let client
    try {
      const info = await lstat(options.get('--client'))
      if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw Error('client')
      client = parseDesktopClient(JSON.parse(await readFile(options.get('--client'), 'utf8')))
    } catch { throw Error('Use a valid Google Desktop app OAuth client file.') }
    const credentials = await authorize(client)
    await writeCredentials(credentialsPath, credentials)
    output('Gmail connected with read-only access.')
    return
  }
  const credentials = await readCredentials(credentialsPath)
  if (command === 'status') {
    output(credentials ? 'Gmail credentials configured. Online access has not been checked.' : 'Gmail is not connected.')
    return
  }
  if (!credentials) { output('Gmail is not connected.'); return }
  if (command === 'forget') {
    await removeCredentials(credentialsPath, credentials)
    output('Local Gmail credentials removed. Google grant revocation has not been confirmed.')
    return
  }
  await revoke(credentials.refreshToken)
  await removeCredentials(credentialsPath, credentials)
  output('Gmail disconnected. Google revoked this project’s granted access.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runGmailCli(process.argv.slice(2)) } catch {
    // Provider and filesystem error text can include private data.
    process.stderr.write(`Gmail command failed. Check command arguments, private file paths, OAuth consent, and network access. ${USAGE}\n`)
    process.exitCode = 1
  }
}
