#!/usr/bin/env bash
# Reproduce bounded EXP-5 parser, API-model and mutation evidence without changing production CI.
set -euo pipefail

experiment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$experiment_dir/../.." && pwd)"

if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" ]]; then
  echo 'Set JAVA_HOME to the pinned JDK 17.0.20.1+1 described in README.md.' >&2
  exit 2
fi
if [[ "$("$JAVA_HOME/bin/java" -version 2>&1)" != *'17.0.20.1'* ]]; then
  echo 'EXP-5 requires the pinned JDK 17.0.20.1+1.' >&2
  exit 2
fi

cd "$repo_dir"
npm ci
npm ci --prefix experiments/exp-5/fixture --ignore-scripts

cd "$experiment_dir"
./gradlew extractCml "-PcmlFile=$experiment_dir/model.cml" "-PoutputFile=$experiment_dir/build/cml-facts.json" --no-daemon

cd "$repo_dir"
npx tsc -p experiments/exp-5/fixture/packages/producer/tsconfig.json
npx api-extractor run --config experiments/exp-5/fixture/packages/producer/api-extractor.json
npx tsc -p experiments/exp-5/fixture/packages/consumer/tsconfig.json
npx api-extractor run --config experiments/exp-5/fixture/packages/consumer/api-extractor.json
npx tsc -p experiments/exp-5/tsconfig.test.json
npx eslint experiments/exp-5 --no-error-on-unmatched-pattern
node experiments/exp-5/.test-build/check.js
NODE_OPTIONS=--experimental-vm-modules npx jest --config experiments/exp-5/jest.config.mjs --runInBand
