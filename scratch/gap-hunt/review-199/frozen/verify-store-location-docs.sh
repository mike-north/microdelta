#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
node -p 'JSON.stringify({node:process.version,platform:process.platform,arch:process.arch})'
git rev-parse HEAD
if [[ "${GAP_HUNT_REUSE_BUILD:-0}" != 1 ]]; then
  npm ci --no-audit --no-fund
  npm run build:packages
fi
npx tsc --noEmit -p packages/machine-node/tsconfig.json
npx tsc --noEmit -p packages/core/tsconfig.json
npx tsc -p packages/machine-node/tsconfig.test.json
node --check scratch/gap-hunt/contract-operations/check-store-location-docs.mjs
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/machine-node/jest.config.mjs --runInBand --runTestsByPath packages/machine-node/.test-build/test/node-location.test.js
node --test scratch/gap-hunt/contract-operations/check-store-location-docs.mjs
