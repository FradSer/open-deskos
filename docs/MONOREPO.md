# Repository projects

This repository contains independently installed projects and named subsystems.
[monorepo.json](../monorepo.json) owns their paths, owner scopes, commands, and declared dependencies.
The root supplies development tools. It is not a pnpm workspace.
Each Node package retains its own manifest, lockfile, and installation policy.
Research sources remain outside the active project inventory.

## Commands

Run these commands from the repository root:

```sh
node tools/repo.mjs list
node tools/repo.mjs check
node tools/repo.mjs affected --since HEAD
node tools/repo.mjs run recommendations test
node tools/repo.mjs run recommendations typecheck
node tools/repo.mjs run personal-agent test
node tools/repo.mjs run shell fast
```

The CLI uses Node built-ins. It needs no root dependency installation.
The affected command includes changed projects and their declared consumers.
The run command uses each project's declared directory and argument list.
Project checks require that project's existing dependencies.
Registered pnpm commands disable automatic dependency installation.
Manual commands report their requirements and return a nonzero status without execution.
Device operations retain their separate authorization requirements.

Use the Node entry directly. The pnpm `repo` shorthand selects a different built-in command.

## Boundaries

The check validates project registration, owner scopes, package names, independent lockfiles, and selected static module boundaries.
Recommendation consumers import only `integrations/personal-agent/src/recommendations/index.mjs`.
The inventory declares the subsystem's reviewed host peers and external packages.
The renderer cannot import backend source modules or backend packages.
The check examines static imports, exports, require calls, and literal dynamic imports.
Computed imports and runtime behavior require separate review.
`recordedDynamicLoaders` records the existing shared Shell loader for manual review.

The [repository workflow](../.github/workflows/repository-checks.yml) runs governance tests and boundary checks on pull requests.
It does not replace package tests, real-model checks, host builds, or device acceptance.
The [nightly matrix](../.github/workflows/nightly-matrix.yml) retains its separate Shell coverage.

## Recommendation ownership

The recommendation subsystem remains inside the Personal Agent installation and release boundary.
Its test and type-check commands can run independently of the full resident suite.
[Unified architecture](../integrations/personal-agent/docs/UNIFIED_ARCHITECTURE.md#recommendation-subsystem) owns runtime responsibilities and injected ports.
[CONTRACT](../integrations/personal-agent/docs/CONTRACT.md) owns proposal, authorization, source, and state contracts.

Pi Durable remains the execution foundation for owner turns and recommendation model sessions.
The package manifest owns pinned Pi versions.
Recommendation extraction does not change state paths, socket messages, action identifiers, or release installation paths.

An independently installed recommendation package is a later step.
That step requires host ports and a verified production dependency closure in each release artifact.
