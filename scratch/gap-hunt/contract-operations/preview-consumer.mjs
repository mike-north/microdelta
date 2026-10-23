// Synthetic retained histogram: exercise only actual alpha operations and show
// exactly where latest/stale/error/coalesced-preview observation is unavailable.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {authoring,openWorkspace,sourceOutcome} from '../../../packages/core/dist/src/index.js';
let fetches=0;let fail=false;
function fetchHistogram(){fetches++;if(fail)throw new Error('synthetic refresh failed');return {buckets:{accepted:3},total:3};}
const a=authoring();
const source=a.source({subject:'histogram',run:({helpers})=>sourceOutcome.fresh(helpers.fetchHistogram())});
const composition=a.compose({scope:'preview-consumer',inputs:[],helpers:[{slot:'fetchHistogram',helper:fetchHistogram}],steps:[{slot:'histogram',declaration:source}]});
const dir=mkdtempSync(join(tmpdir(),'microdelta-preview-'));
const w=openWorkspace({location:join(dir,'history.sqlite'),logicalStore:'preview-consumer'});
const options={authoring:a,composition,environment:'trial'};
const target={scope:'preview-consumer',role:'step',slot:'histogram'};
try{
 const cold=await w.run(options,r=>r.resolve(target,{requestKey:'cold'}));
 assert.equal(cold.value.kind,'published');const reference=cold.value.reference;
 fail=true;
 let refreshError;
 try{await w.run(options,r=>r.resolve(target,{requestKey:'refresh'}));}catch(e){refreshError={name:e.name,code:e.code,message:e.message};}
 assert.equal(refreshError.code,'execution-failure');assert.equal(fetches,2);
 const observed=await w.run(options,r=>{
  const runOperations=Object.keys(r).sort();let value;
  for(let i=0;i<1000;i++)value=r.read(reference);
  return {runOperations,value,fetches};
 });
 assert.deepEqual(observed.value.value,{buckets:{accepted:3},total:3});assert.equal(fetches,2);
 console.log(JSON.stringify({cold:{kind:cold.value.kind,reference},refreshError,exactReadControl:observed.value,targetBoundary:'No supported latest-preview envelope or throttled value/status observation entry exists in the available run type. Exact reads are safe but caller must supply old reference and combine refresh error/status itself.'}));
}finally{w.close();rmSync(dir,{recursive:true,force:true});}
