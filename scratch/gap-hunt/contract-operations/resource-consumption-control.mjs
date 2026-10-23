// Valid consumption control only; resource-state absence is checked separately.
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDurableAccounting} from '../../../packages/accounting/dist/src/index.js';
import {createNodeSqlite} from '../../../packages/machine-node/dist/src/index.js';
const dir=mkdtempSync(join(tmpdir(),'microdelta-quota-state-'));
let accounting;
try {
 accounting=openDurableAccounting({location:join(dir,'usage.sqlite'),logicalStore:'quota-probe',sqlite:createNodeSqlite()});
 for (const [i,delta] of [2,3].entries()) {
  accounting.recordUsageIntent({environment:'trial',operation:`operation-${i}`,requestAttempt:`request-${i}`,attribution:{run:'run',member:null,stepAttempt:null}});
  accounting.acknowledgeUsage({environment:'trial',operation:`operation-${i}`,requestAttempt:`request-${i}`,report:`response-${i}`,quantities:[{unit:'requests',amount:delta}]});
 }
 const summary=accounting.summarizeUsage({environment:'trial'});
 assert.equal(summary.observed.find(q=>q.unit==='requests')?.amount,5,'Additive consumption positive control');
 console.log(JSON.stringify({additivePositiveControl:{requestDeltas:[2,3],observedRequests:5},unknown:summary.unknown,status:summary.status}));
} finally {accounting?.close();rmSync(dir,{recursive:true,force:true});}
