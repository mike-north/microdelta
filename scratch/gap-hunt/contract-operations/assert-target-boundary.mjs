// Snapshot assertions cover the complete generated owning surfaces. A changed
// surface fails for renewed semantic review; guessed method names are not probes.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const target=process.argv[2];
assert.ok(['cli','preview','resource-state'].includes(target));
const child=spawnSync(process.execPath,['scratch/gap-hunt/contract-operations/inspect-surface.mjs'],{encoding:'utf8'});
assert.equal(child.status,0,child.stderr);
const inventory=JSON.parse(child.stdout);
const names=name=>inventory.surfaces[name].map(p=>p.name).sort();
if(target==='cli'){
 assert.ok(inventory.packages.every(p=>p.bin===null),'A new executable requires renewed CLI contract review');
 assert.deepEqual(names('IWorkspace'),['close','logicalStore','run']);
 const cli=spawnSync('npm',['exec','--offline','--','microdelta','--help'],{encoding:'utf8'});
 assert.notEqual(cli.status,0);assert.match(cli.stderr,/could not determine executable to run/);
 console.log('CONTROL: npm executable discovery fails; all manifests lack bin; workspace read access still requires run.');
}else if(target==='preview'){
 assert.deepEqual(names('IWorkspaceRun'),['read','usage','context','open','resolve','resolveMembers','resolveFold','resolveOutcomeFold','check','recover','ordinary','inspectOperations','settleOperation','promote','promotions'].sort());
 assert.deepEqual(names('IRunObserver'),['observe']);
 console.log('CONTROL: complete run/observer surface matches reviewed exact-read and restricted lifecycle-event capabilities.');
}else{
 assert.deepEqual(names('IUsageQuantity'),['amount','unit']);
 assert.deepEqual(names('IUsageReport'),['environment','operation','quantities','report','requestAttempt']);
 assert.deepEqual(names('IDurableAccounting'),['acknowledgeUsage','close','recordEstimate','recordUsageIntent','summarizeUsage']);
 console.log('CONTROL: complete Accounting surface matches reviewed additive consumption port; no state/pool/window/reset record or query.');
}
console.error(`TARGET GAP (${target}): required capability has no supported entry in the reviewed owning surface; owner decision is required. This exit1 is a target-capability assertion, not a regression assertion.`);
process.exitCode=1;
