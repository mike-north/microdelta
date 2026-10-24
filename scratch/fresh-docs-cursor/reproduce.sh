#!/bin/sh
set -eu
# Invoke from repository root under Node 24. All run logs are ignored/external.
task_output=${MICRODELTA_PROBE_OUTPUT:-.test-build/fresh-docs-cursor/run}
mkdir -p "$task_output"
task_output=$(cd "$task_output" && pwd)
export MICRODELTA_PROBE_OUTPUT="$task_output"
exec > "$task_output/reproduce.log" 2>&1
node -e 'if (process.versions.node.split(".")[0] !== "24") { throw new Error("Node 24 required"); }'
npm ci
npm run build
npx tsc -p scratch/fresh-docs-cursor/tsconfig.json
npx eslint --config scratch/fresh-docs-cursor/eslint.config.mjs scratch/fresh-docs-cursor/*.ts
node --experimental-vm-modules node_modules/jest/bin/jest.js --config scratch/fresh-docs-cursor/jest.config.mjs --runInBand
node scratch/fresh-docs-cursor/controls.mjs
