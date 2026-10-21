---
name: open-deskos-widget
description: Project entry point for Open DeskOS Widget, App, and shared interface work. Use the canonical odk-widget workflow for implementation and verification.
---
# Open DeskOS Widget entry point

Read the [canonical Widget workflow](../odk-widget/SKILL.md) before implementation.
It owns design, theme, interaction, and verification rules for the shared Electron Shell.
For shared theme changes, read [surface-family consistency](../odk-widget/references/design.md#surface-family-consistency) and [interaction coverage](../odk-widget/references/verification.md#theme-interaction-coverage).
Use [odk-widget-reflect](../odk-widget-reflect/SKILL.md) when reflection is requested.
Keep this entry point short; maintain reusable rules in the canonical workflow and its references.
