const test = require('node:test')
const assert = require('node:assert/strict')

const { isPiProcess, tokenizeWindowsCommandLine } = require('../src/pi-sessions')

test('a Windows command line is tokenized by quoting rules, not by whitespace', () => {
  assert.deepEqual(tokenizeWindowsCommandLine('pi'), ['pi'])
  assert.deepEqual(
    tokenizeWindowsCommandLine('"C:\\Program Files\\nodejs\\node.exe" C:\\tools\\pi.mjs'),
    ['C:\\Program Files\\nodejs\\node.exe', 'C:\\tools\\pi.mjs'],
  )
  assert.deepEqual(
    tokenizeWindowsCommandLine('node.exe "C:\\my tools\\pi.js" --flag'),
    ['node.exe', 'C:\\my tools\\pi.js', '--flag'],
  )
  assert.deepEqual(
    tokenizeWindowsCommandLine('pi --prompt "say \\"hi\\""'),
    ['pi', '--prompt', 'say "hi"'],
  )
  // A path ending in a backslash must be written with two: an odd run of
  // backslashes escapes the quote, so this one swallows what follows it.
  assert.deepEqual(tokenizeWindowsCommandLine('"C:\\my tools\\" pi'), ['C:\\my tools" pi'])
  assert.deepEqual(tokenizeWindowsCommandLine('"C:\\my tools\\\\" pi'), ['C:\\my tools\\', 'pi'])
  assert.deepEqual(tokenizeWindowsCommandLine('   '), [])
  assert.deepEqual(tokenizeWindowsCommandLine(''), [])
  assert.deepEqual(tokenizeWindowsCommandLine(null), [])
})

test('Windows launcher suffixes do not hide a Pi executable', () => {
  const rows = [
    'pi',
    'pi.exe',
    'PI.EXE',
    'pi.cmd',
    'pi.ps1',
    'C:\\Users\\desk\\AppData\\Roaming\\npm\\pi.cmd',
    'node C:\\Users\\desk\\AppData\\Roaming\\npm\\node_modules\\pi\\pi.js',
    '"C:\\Program Files\\nodejs\\node.exe" C:\\tools\\pi.mjs',
    'cmd /c pi',
    'cmd.exe /c "node C:\\tools\\pi.js"',
    'pwsh -Command pi',
    'powershell.exe -NoProfile -Command pi',
    'npx pi',
    'pnpm exec pi',
  ]

  for (const command of rows) {
    assert.equal(isPiProcess({ comm: 'unknown.exe', args: command, tokens: tokenizeWindowsCommandLine(command) }), true, command)
  }
})

test('a Windows process that is not Pi is never a session', () => {
  const rows = [
    'C:\\Windows\\explorer.exe',
    'node C:\\tools\\serve.js',
    'cmd /c dir',
    'notepad.exe',
    'pip install requests',
    'ping 127.0.0.1',
  ]

  for (const command of rows) {
    assert.equal(isPiProcess({ comm: 'unknown.exe', args: command, tokens: tokenizeWindowsCommandLine(command) }), false, command)
  }
})

test('a bare Windows executable name is recognized without a command line', () => {
  assert.equal(isPiProcess({ comm: 'pi.exe', args: '' }), true)
  assert.equal(isPiProcess({ comm: 'PI.EXE', args: '' }), true)
  assert.equal(isPiProcess({ comm: 'ping.exe', args: '' }), false)
})

test('a Windows process row is recognized without an args field', () => {
  // A Windows host reports a command line and the tokens derived from it; it has
  // no `args` field, which is the POSIX process table's shape.
  assert.equal(isPiProcess({ comm: 'node.exe', command: 'node C:\\tools\\pi.js', tokens: ['node', 'C:\\tools\\pi.js'] }), true)
  assert.equal(isPiProcess({ comm: 'pi.exe', command: 'pi --continue', tokens: ['pi', '--continue'] }), true)
  assert.equal(isPiProcess({ comm: 'notepad.exe', command: 'notepad.exe', tokens: ['notepad.exe'] }), false)
  assert.equal(isPiProcess({ comm: 'explorer.exe', command: '', tokens: [] }), false)
})

test('a quoted shell argument keeps its inner quoting', () => {
  const command = 'cmd /c "node C:\\my tools\\pi.js"'
  assert.equal(isPiProcess({ comm: 'cmd.exe', args: command, tokens: tokenizeWindowsCommandLine(command) }), true)
})

test('a shell wrapper keeps its argument boundaries', () => {
  // The outer tokenizer already split these arguments, so re-joining them into a
  // string would split a quoted program path back apart and lose the session.
  const commands = [
    'cmd.exe /c "C:\\Program Files\\nodejs\\node.exe" C:\\tools\\pi.js',
    'cmd /c "node" "C:\\my tools\\pi.js"',
    'powershell.exe -NoProfile -Command "C:\\Program Files\\nodejs\\node.exe" C:\\tools\\pi.js',
  ]

  for (const command of commands) {
    assert.equal(isPiProcess({ comm: 'cmd.exe', args: command, tokens: tokenizeWindowsCommandLine(command) }), true, command)
  }
  assert.equal(isPiProcess({ comm: 'cmd.exe', args: 'cmd /c "C:\\Program Files\\nodejs\\node.exe" C:\\tools\\serve.js', tokens: tokenizeWindowsCommandLine('cmd /c "C:\\Program Files\\nodejs\\node.exe" C:\\tools\\serve.js') }), false)
})

// `cmd /c "<whole command line>"` arrives as one argument: the outer
// tokenization consumed its inner quoting, so the argument still has to be read
// as a command line — including its flags and any command chained after a
// shell builtin.
test('a wrapped command line keeps its flags and chained commands', () => {
  const commands = [
    'cmd /c "node C:\\tools\\pi.js --continue"',
    'cmd /c "node C:\\tools\\pi.js --model sonnet"',
    'cmd.exe /c "C:\\Program Files\\nodejs\\node.exe" C:\\tools\\pi.js --continue',
    'cmd /c "cmd /c pi"',
    'cmd /c "powershell -Command pi"',
    'cmd /c "set FOO=1 && pi"',
    'cmd.exe /c "git pull && pi"',
  ]

  for (const command of commands) {
    assert.equal(isPiProcess({ comm: 'cmd.exe', args: command, tokens: tokenizeWindowsCommandLine(command) }), true, command)
  }

  const negatives = [
    'cmd /c "node C:\\tools\\serve.js --port 3000"',
    'cmd /c "set FOO=1 && dir"',
    'cmd /c "git pull && npm test"',
  ]
  for (const command of negatives) {
    assert.equal(isPiProcess({ comm: 'cmd.exe', args: command, tokens: tokenizeWindowsCommandLine(command) }), false, command)
  }
})

// A Windows command line does not need spaces around its separators, and a
// redirection adds its own arguments after the quoted command line.
test('a chained or redirected wrapper is still recognized', () => {
  const commands = [
    'cmd /c set FOO=1 && pi',
    'cmd /c "set FOO=1 && pi"',
    'cmd /c git pull && pi',
    'cmd /c "git pull && pi"',
    'cmd /c "node pi.js" 2>&1',
    'cmd /c "node pi.js" > log.txt',
    'cmd.exe /c "node C:\\tools\\pi.js" >> output.txt',
    'cmd /c "node pi.js > log.txt"',
  ]

  for (const command of commands) {
    assert.equal(isPiProcess({ comm: 'cmd.exe', args: command, tokens: tokenizeWindowsCommandLine(command) }), true, command)
  }

  const negatives = ['cmd /c "set FOO=1 && dir"', 'cmd /c "git pull && npm test"', 'cmd /c dir && where node']
  for (const command of negatives) {
    assert.equal(isPiProcess({ comm: 'cmd.exe', args: command, tokens: tokenizeWindowsCommandLine(command) }), false, command)
  }
})

// When the whole command line is one quoted argument, its inner quoting is gone
// and `&` / `|` cannot be told apart from a filename character. Reading them as
// separators over-accepted `cmd /c node "C:\tools\pi&b.js"` as Pi — and an
// accepted non-Pi row enters the scan's Pi pid set, where a session parented by
// that pid is discarded as a worker and disappears from the desk. So these two
// forms stay unrecognized; the boundary is pinned here rather than left to luck.
test('an ambiguous separator inside one quoted argument stays unrecognized', () => {
  const conceded = [
    'cmd /c "set FOO=1&&pi"',
    'cmd /c "dir&&pi"',
    'cmd /c "echo C:\\tools\\a&pi"',
  ]
  for (const command of conceded) {
    assert.equal(isPiProcess({ comm: 'cmd.exe', args: command, tokens: tokenizeWindowsCommandLine(command) }), false, command)
  }

  // The false positive that made the choice: a protected `&` inside a filename.
  const command = 'cmd /c node "C:\\tools\\pi&b.js"'
  assert.equal(isPiProcess({ comm: 'cmd.exe', args: command, tokens: tokenizeWindowsCommandLine(command) }), false, command)
  assert.equal(isPiProcess({ comm: 'cmd.exe', args: 'cmd /c "echo pi" > log.txt', tokens: tokenizeWindowsCommandLine('cmd /c "echo pi" > log.txt') }), true, 'a program whose first argument names pi is the known over-acceptance, not a new one')
})

test('a quoted command line keeps the arguments that follow it', () => {
  // `2 > log.txt` separates the `2` from the redirection, so cmd passes `2` as an
  // argument and redirects stdout: the command line still runs Pi.
  const command = 'cmd /c "node pi.js" 2 > log.txt'
  assert.equal(isPiProcess({ comm: 'cmd.exe', args: command, tokens: tokenizeWindowsCommandLine(command) }), true)

  const negative = 'cmd /c "node serve.js" 2 > log.txt'
  assert.equal(isPiProcess({ comm: 'cmd.exe', args: negative, tokens: tokenizeWindowsCommandLine(negative) }), false, negative)

  // A trailing argument is read the same way whether or not a redirection was
  // stripped, so the answer never depends on an incidental redirection. These two
  // are true through the recorded class (a command whose first non-flag argument
  // names a script called `pi`), which the same shape without a quoted argument
  // already reaches: `cmd /c echo pi` is true as well.
  for (const command of ['cmd /c "echo pi" extra', 'cmd /c "echo pi" 2 > log.txt', 'cmd /c "echo pi" > log.txt', 'cmd /c echo pi']) {
    assert.equal(isPiProcess({ comm: 'cmd.exe', args: command, tokens: tokenizeWindowsCommandLine(command) }), true, command)
  }
  const notPi = 'cmd /c "node serve.js" extra'
  assert.equal(isPiProcess({ comm: 'cmd.exe', args: notPi, tokens: tokenizeWindowsCommandLine(notPi) }), false, notPi)
})

// `://` is the one thing that makes a value certainly not a path. Beyond that,
// Windows accepts either separator in the same path, so the last of them wins.
test('a value that is not a path is not read as one', () => {
  assert.equal(isPiProcess({ comm: 'curl', args: 'curl https://example.com/a\\pi.js' }), false)
  assert.equal(isPiProcess({ comm: 'node.exe', command: 'node C:\\tools\\pi.js', tokens: ['node', 'C:\\tools\\pi.js'] }), true, 'a real Windows path still is one')
  assert.equal(isPiProcess({ comm: 'node.exe', command: 'node C:\\tools/a\\b\\pi.js', tokens: ['node', 'C:\\tools/a\\b\\pi.js'] }), true, 'a mixed-separator Windows path is still a path')
  assert.equal(isPiProcess({ comm: 'node.exe', command: 'node C:/tools\\x\\pi.js', tokens: ['node', 'C:/tools\\x\\pi.js'] }), true)
  // The same shape with a forward slash is the reference host's pre-existing
  // over-acceptance (a recorded class), not something this host introduces.
  assert.equal(isPiProcess({ comm: 'curl', args: 'curl https://example.com/a/pi.js' }), true)
})

// A process table is untrusted input. Absurd input must answer 'not Pi', never
// throw: a throw on the Windows path empties the Pi process set and hides every
// session, and on the POSIX parse path it escapes the scan.
test('absurd wrapper nesting and long chains answer instead of overflowing the stack', () => {
  const nested = `${'cmd /c "'.repeat(400)}pi${'"'.repeat(400)}`
  assert.equal(isPiProcess({ comm: 'cmd.exe', args: nested, tokens: tokenizeWindowsCommandLine(nested) }), false)

  const chained = `cmd /c "set FOO=1${' && set BAR=2'.repeat(500)} && pi"`
  assert.equal(isPiProcess({ comm: 'cmd.exe', args: chained, tokens: tokenizeWindowsCommandLine(chained) }), true)

  assert.equal(isPiProcess({ comm: 'cmd.exe', args: '&&'.repeat(2000), tokens: tokenizeWindowsCommandLine('&&'.repeat(2000)) }), false)
  assert.equal(isPiProcess({ comm: 'cmd.exe', args: '|||', tokens: tokenizeWindowsCommandLine('|||') }), false)
})

// A quoted command line is genuinely ambiguous once its inner quoting is gone:
// `node C:\my tools\pi.js --continue` could be a path with spaces or a path
// followed by flags. Both readings are tried, and this intersection — spaces and
// flags together inside one quoted argument — is the one the desk does not
// claim to recognize. It is pinned so the boundary stays visible rather than
// looking like an accident.
test('a quoted command line with both spaces and flags stays unrecognized', () => {
  const command = 'cmd /c "node C:\\my tools\\pi.js --continue"'
  assert.equal(isPiProcess({ comm: 'cmd.exe', args: command, tokens: tokenizeWindowsCommandLine(command) }), false)
})

test('a Linux command line keeps whitespace tokenization unchanged', () => {
  assert.equal(isPiProcess({ comm: 'pi', args: '' }), true)
  assert.equal(isPiProcess({ comm: 'node', args: '/usr/local/lib/node_modules/pi/dist/pi.js --continue' }), true)
  assert.equal(isPiProcess({ comm: 'node', args: '/srv/app/server.js' }), false)
})