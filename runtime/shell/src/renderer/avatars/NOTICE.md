# Onee avatar

Onee and its behavior library come from [Bible Strong Avatar Lab](https://github.com/smontlouis/bible-strong-avatar-lab).
Author: Stéphane Montlouis-Calixte. License: AGPL-3.0-only.
Source commit: `79fe9ba06e4874b11394b8e8a3f2c493c9d197ba`.

The definition uses the upstream `createAvatarDefinition` mapping and Onee eye defaults.
Geometry, colors, expressions, and base animation timing are retained.
Two finite reactions select original expressions and use shorter interaction timing.
The original Studio project is `src/features/studio/defaultStudioDocument.json` at that commit.

The local SDK bundle contains `@bible-strong/avatar-web` and `@bible-strong/avatar-core` version 0.1.0.
Both packages use AGPL-3.0-only. Their package sources and license notices remain in the dependency archives.
The build compiles the JSON schema validator ahead of time to preserve the Shell content security policy.

The build corrects three shape-field schema bounds to 0..2, as used by upstream geometry and the original Onee definition.
All other validation rules remain active.
