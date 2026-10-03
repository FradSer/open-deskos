# odk-process (Windows process reader)

An optional native addon for the Windows Shell Host. It is the only place the
desk reads another process's working directory, because Windows exposes it only
through the target's PEB.

## What it exposes

```js
const reader = require('./odk_process.node')

reader.listProcesses()
// [{ pid, ppid, exe, command, startedAtMs, cwd }]
// cwd and command are empty strings when the target cannot be read.

reader.processCwd(pid)
// '' when the target cannot be read.
```

A target at a higher integrity level, a protected process, and a 32-bit (WOW64)
target all answer with an empty directory. That is deliberate: the desk states a
session's work directory as unknown rather than decoding it with a layout that
does not apply.

## Build

```sh
pnpm run build:native
```

On a non-Windows host the script is a no-op. On Windows it builds against
Electron's headers, so the module matches the process that loads it:

```sh
node-gyp rebuild --directory=native/odk-process \
  --runtime=electron --target=<electron version> --arch=x64 \
  --dist-url=https://electronjs.org/headers
```

It needs a C++ toolchain (Visual Studio Build Tools with the C++ workload and
Python). Without it, the desk still starts: the shell falls back to a managed
process-table read and every session work directory reads as unknown.

## Loading

After a successful build the script loads the artifact inside Electron's own Node
(`ELECTRON_RUN_AS_NODE=1`). That step exists because compiling is not loading:
on Windows the symbols a native module needs are exported by `electron.exe`
rather than by a `node.dll`, so a module built without Electron's delay-load hook
compiles and then refuses to load with `Module did not self-register` or `The
specified procedure could not be found`. `binding.gyp` therefore keeps
`win_delay_load_hook` set to `true` at both the top level and the target; if the
load check ever fails, that variable is the first thing to inspect.

## Artifact

`build/Release/odk_process.node`, which Git ignores and the release tooling does
not stage. A Windows host builds it once after installing.