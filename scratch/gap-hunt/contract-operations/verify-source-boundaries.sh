#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
node -p 'JSON.stringify({node:process.version,platform:process.platform,arch:process.arch})'
git rev-parse HEAD
if [[ "${GAP_HUNT_REUSE_BUILD:-0}" != 1 ]]; then
  npm ci --no-audit --no-fund
  npm run build:packages
fi
npx tsc -p packages/core/tsconfig.test.json
npx tsc --noEmit -p packages/core/tsconfig.json
npx eslint packages/core/test/gap-hunt-durability-source-boundaries.test.ts
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-durability-source-boundaries.test.js
