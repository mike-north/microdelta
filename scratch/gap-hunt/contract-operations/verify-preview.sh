#!/usr/bin/env bash
# Clean-checkout replay: installs locked dependencies and builds declarations.
# Exit1 after CONTROL messages is the expected missing-target assertion.
set -euo pipefail
cd "$(dirname "$0")/../../.."
node -e 'if(process.version!=="v24.22.1")throw new Error("Use pinned Node24.22.1")'
npm ci --no-audit --no-fund
npm run build:packages
node scratch/gap-hunt/contract-operations/preview-consumer.mjs
node scratch/gap-hunt/contract-operations/assert-target-boundary.mjs preview
