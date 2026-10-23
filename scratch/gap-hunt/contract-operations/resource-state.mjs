// Consumer counterexample: remaining quota is state, while the available
// Accounting reporting port explicitly accepts additive consumption only.
// This intentionally demonstrates that encoding state as quantities is wrong;
// it does not allege that additive summation violates its own API contract.
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
 for (const [i,remaining] of [93,90].entries()) {
  accounting.recordUsageIntent({environment:'trial',operation:`operation-${i}`,requestAttempt:`request-${i}`,attribution:{run:'run',member:null,stepAttempt:null}});
  accounting.acknowledgeUsage({environment:'trial',operation:`operation-${i}`,requestAttempt:`request-${i}`,report:`response-${i}`,quantities:[{unit:'github.remaining',amount:remaining}]});
 }
 const summary=accounting.summarizeUsage({environment:'trial'});
 console.log(JSON.stringify({consumerNeeds:'nonadditive remaining quota by pool/window',availablePort:'additive consumption quantities',observed:summary.observed}));
 assert.equal(summary.observed.find(q=>q.unit==='github.remaining')?.amount,90,'Consumer latest-state requirement cannot be met by encoding remaining quota as consumption');
} finally {accounting?.close();rmSync(dir,{recursive:true,force:true});}
