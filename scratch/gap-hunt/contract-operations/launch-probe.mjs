// Compare inert argv with file-fed transport, then the actual lifecycle worker.
// No child in this probe requests SIGKILL; an empty trace cannot count as a reached fault.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'microdelta-launch-'));
const minimal=resolve('scratch/gap-hunt/contract-operations/launch-child.mjs');
const worker=resolve('packages/core/.test-build/test/durable-history/worker.js');
const fileWorker=resolve('packages/core/.test-build/test/gap-hunt-durability-worker.js');
const marker=join(dir,'entered');
function run(label,path,args){
 rmSync(marker,{force:true});
 const r=spawnSync(process.execPath,[path,...args],{encoding:'utf8',timeout:5000,env:{...process.env,MICRODELTA_LAUNCH_MARKER:marker}});
 console.log(JSON.stringify({label,argumentBytes:args.reduce((n,a)=>n+Buffer.byteLength(a),0),status:r.status,signal:r.signal,error:r.error?.code??null,entered:path===minimal?existsSync(marker):null,stdout:r.stdout,stderr:r.stderr}));
}
try{
 for(const size of [0,500,700,900,1000,10000,64000,128000]){
  const data=JSON.stringify({padding:'x'.repeat(size)});const file=join(dir,'inert.json');writeFileSync(file,data);
  run(`inert-argv-${size}`,minimal,[data]);run(`inert-file-${size}`,minimal,['--file',file]);
 }
 const steps=[{op:'time',at:1000},{op:'acquire',holder:'stale',lease:100},{op:'allocate',request:{analysis:'analysis:contributors',environment:'env:trial',subject:'summary:acme/widget:2026-Q1:person:ada',version:1,attemptKey:'trial-ada',intentDigest:'intent:trial-ada'}},{op:'stage',payload:{label:'trial'},label:'trial'},{op:'publish'},{op:'release'}];
 const journalSteps=[...steps.slice(0,5),{op:'journal',formats:[{format:'test.supervision.operation',versions:[1]},{format:'test.supervision.deferral',versions:[1]}]},{op:'journal-commit',scope:{analysis:'analysis:contributors',environment:'env:trial'},writes:[{collection:'operations',key:'op-assess-ada',expectedRevision:0,record:{format:'test.supervision.operation',formatVersion:1,content:{member:'m-ada',name:'assess',bindingDigest:'sha256:binding',state:'pending'}}}]}];
 for(const transport of ['argv','file']){
  const data=JSON.stringify({location:join(dir,`journal-${transport}.sqlite`),store:'store:contributors',steps:journalSteps});const file=join(dir,'journal.json');writeFileSync(file,data);
  run(`journal-seed-${transport}`,transport==='argv'?worker:fileWorker,[transport==='argv'?data:file]);
 }
 for(const count of [2,3,4,6]){
  for(const transport of ['argv','file']){
   const data=JSON.stringify({location:join(dir,`history-${count}-${transport}.sqlite`),store:'store:contributors',steps:steps.slice(0,count)});const file=join(dir,'worker.json');writeFileSync(file,data);
   run(`actual-${transport}-${count}steps`,transport==='argv'?worker:fileWorker,[transport==='argv'?data:file]);
  }
 }
}finally{rmSync(dir,{recursive:true,force:true});}
