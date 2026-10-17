#!/bin/sh
# The generated helper follows the active immutable release without requiring its caller's service environment.
export ODK_TASK_CONFIG="${ODK_TASK_CONFIG:-__ODK_TASK_CONFIG__}"
exec "__ODK_NODE_BIN__/node" "__ODK_PERSONAL_BOT_DIR__/src/task-cli.mjs"
