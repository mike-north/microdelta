#!/usr/bin/env bash
# Self-contained external-consumer reproduction. Installs pinned public packages
# into a disposable directory, never alters repository/global package settings.
set -Eeuo pipefail
printf 'native-approval-runner platform=%s; Linux remains unverified unless this run is Linux\n' "$(uname -s)"
node -e 'if(process.version!=="v24.22.1")throw new Error("Use Node v24.22.1 for this pinned reproduction")'
case "${1:-both}" in
  both) versions=(10.34.7 12.10.1) ;;
  10.34.7|12.10.1) versions=("$1") ;;
  *) echo 'Usage: bash verify-157.sh [both|10.34.7|12.10.1]' >&2; exit 2 ;;
esac
probe_root=$(mktemp -d /tmp/md157.XXXXXX)
trap 'rm -rf "$probe_root"' EXIT
trap 'code=$?; for log in "$consumer"/*.log; do if [[ -f "$log" ]]; then printf "diagnostic %s\n" "${log##*/}"; cat "$log"; fi; done; exit "$code"' ERR
for version in "${versions[@]}"; do
  consumer="$probe_root/pnpm-$version"
  mkdir -p "$consumer"
  cat > "$consumer/package.json" <<'JSON'
{"name":"microdelta-native-consumer","private":true,"type":"module","dependencies":{"microdelta":"0.2.0"}}
JSON
  cat > "$consumer/memory.mjs" <<'JS'
import {createMemoryStore} from 'microdelta';
const store=createMemoryStore();await store.meta();await store.close();console.log('public-memory-ok');
JS
  cat > "$consumer/durable.mjs" <<'JS'
import {authoring,openWorkspace} from 'microdelta';
import {fileURLToPath} from 'node:url';
let calls=0;const a=authoring();
const value=a.memo({subject:'value',run:()=>{calls++;return {text:'retained'};}});
const composition=a.compose({scope:'portability',inputs:[],helpers:[],steps:[{slot:'value',declaration:value}]});
const w=openWorkspace({location:fileURLToPath(new URL('./history.sqlite',import.meta.url)),logicalStore:'portability'});
try{const r=await w.run({authoring:a,composition,environment:'fixture'},run=>run.resolve({scope:'portability',role:'step',slot:'value'},{requestKey:`request:${Date.now()}`}));console.log(JSON.stringify({calls,outcome:r.value}));}finally{w.close();}
JS
  manager="$probe_root/manager-$version"
  manager_bin=""
  if [[ "$version" == 12.10.1 && -n "${PNPM12_BIN:-}" ]]; then manager_bin="$PNPM12_BIN"; fi
  if [[ -z "$manager_bin" ]]; then
    npm install --prefix "$manager" --no-audit --no-fund --ignore-scripts "pnpm@$version" > "$consumer/manager.log" 2>&1
    manager_bin="$manager/node_modules/.bin/pnpm"
  fi
  [[ "$("$manager_bin" --version)" == "$version" ]]
  # Use only a local consumer/store. Prerequisite: a fresh Linux user/container
  # with no inherited pnpm allow-build setting; do not disable trust checks.
  run_pnpm() { "$manager_bin" --dir "$consumer" --store-dir "$probe_root/store-$version" "$@"; }
  if run_pnpm install > "$consumer/install.log" 2>&1; then install_status=0; else install_status=$?; fi
  if node "$consumer/durable.mjs" > "$consumer/unapproved.log" 2>&1; then durable_status=0; else durable_status=$?; fi
  printf 'pnpm=%s install=%s unapproved-durable=%s\n' "$version" "$install_status" "$durable_status"
  if [[ "$version" == 10.34.7 ]]; then
    [[ "$install_status" == 0 ]]
    grep -q 'Ignored build scripts' "$consumer/install.log"
  else
    [[ "$install_status" != 0 ]]
    grep -q 'ERR_PNPM_IGNORED_BUILDS' "$consumer/install.log"
  fi
  [[ "$durable_status" != 0 ]]
  grep -q 'Could not locate the bindings file' "$consumer/unapproved.log"
  node "$consumer/memory.mjs"
  cat > "$consumer/pnpm-workspace.yaml" <<'YAML'
allowBuilds:
  better-sqlite3: true
YAML
  run_pnpm rebuild better-sqlite3 > "$consumer/rebuild.log" 2>&1
  node "$consumer/durable.mjs" > "$consumer/cold.json"
  node "$consumer/durable.mjs" > "$consumer/restart.json"
  cat > "$consumer/assert.mjs" <<'JS'
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const cold=JSON.parse(readFileSync(new URL('./cold.json',import.meta.url)));
const restart=JSON.parse(readFileSync(new URL('./restart.json',import.meta.url)));
assert.equal(cold.calls,1);assert.equal(cold.outcome.kind,'published');
assert.equal(restart.calls,0);assert.equal(restart.outcome.kind,'reused');
assert.deepEqual(restart.outcome.reference,cold.outcome.reference);
console.log(JSON.stringify({coldCalls:cold.calls,restartCalls:restart.calls,exactReference:restart.outcome.reference}));
JS
  node "$consumer/assert.mjs"
done
