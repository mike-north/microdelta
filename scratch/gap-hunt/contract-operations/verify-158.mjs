// Metadata-only support-boundary reproduction. Does not install native code,
// change engine ranges or claim Node26 runtime support. Runs on Linux or macOS.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
function view(pkg,...fields){const r=spawnSync('npm',['view',pkg,...fields,'--json'],{encoding:'utf8',timeout:30000});if(r.status!==0)throw new Error(`npm metadata failed: ${r.stderr}`);return JSON.parse(r.stdout);}
const facade=view('microdelta@0.2.0','engines');
const machine=view('@microdelta/machine-node@0.1.0','engines','dependencies');
const driver=view('better-sqlite3@12.9.0','engines');
assert.equal(facade.node,'>=20');assert.equal(machine.engines.node,'>=20');
assert.equal(machine.dependencies['better-sqlite3'],'12.9.0');
assert.equal(driver.node,'20.x || 22.x || 23.x || 24.x || 25.x');
const localFacade=JSON.parse(readFileSync('packages/core/package.json'));
const localMachine=JSON.parse(readFileSync('packages/machine-node/package.json'));
console.log(JSON.stringify({node:process.version,platform:process.platform,published:{facade:facade.node,machine:machine.engines.node,driver:driver.node},local:{facade:localFacade.engines.node,machine:localMachine.engines.node,driver:localMachine.dependencies['better-sqlite3']},mismatch:'Node26 satisfies advertised >=20 but not pinned driver range',pickupScope:'accurate durable-backend support/native prerequisites documentation and checks; no engine-range change, driver switch, or Node26 support expansion'},null,2));
