/** Verify #169 preserves the separate #156 scalar-root limitation at runtime. */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const directory=mkdtempSync(join(tmpdir(),'microdelta-async-root-'));
const results=[];
try {
 for(const mode of ['scalar','wrapped']) {
  const result=spawnSync(process.execPath,['scratch/gap-hunt/review-181/root-worker.mjs',mode,join(directory,mode+'.sqlite')],{encoding:'utf8'});
  assert.equal(result.status,0);const report=JSON.parse(result.stdout);assert.equal(report.calls,1);
  if(mode==='scalar'){assert.equal(report.kind,'threw');assert.match(report.message,/without a record or array root/u);}
  else {assert.equal(report.kind,'returned');assert.equal(report.result.kind,'published');}
  results.push({mode,report});
 }
} finally {rmSync(directory,{recursive:true,force:true});}
const data=JSON.stringify({passed:2,issue156:'remains open: scalar root refused; wrapped object accepted',results},null,2)+'\n';
writeFileSync('scratch/gap-hunt/review-181/local-results/root-boundary.json',data);process.stdout.write(data);
