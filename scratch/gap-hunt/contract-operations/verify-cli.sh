#!/usr/bin/env bash
# Clean-checkout replay: installs locked dependencies and builds declarations.
# Successful diagnostic controls exit0. No forced failing product assertion.
set -euo pipefail
cd "$(dirname "$0")/../../.."
node -e 'if(!process.versions.node.startsWith("24."))throw new Error("Use Node24.x for this reproduction");console.log(`node=${process.version} platform=${process.platform} arch=${process.arch}`)'
npm ci --no-audit --no-fund
npm run build:packages
node scratch/gap-hunt/contract-operations/preview-consumer.mjs
node scratch/gap-hunt/contract-operations/assert-target-boundary.mjs cli
