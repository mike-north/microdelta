// Explore lifecycle ownership through the supported generic run/ordinary API.
// No memo/source stores an iterator; all work here is nonmemoized.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {authoring,openWorkspace,currentRun} from '../../../packages/core/dist/src/index.js';
const a=authoring();const composition=a.compose({scope:'lazy',inputs:[],helpers:[],steps:[]});
const dir=mkdtempSync(join(tmpdir(),'microdelta-lazy-'));
const workspace=openWorkspace({location:join(dir,'history.sqlite'),logicalStore:'lazy'});
const options={authoring:a,composition,environment:'env:lazy'};const observations=[];
function observe(where){const c=currentRun();observations.push({where,runId:c.runId,environment:c.environment});}
async function* values(throwAtEnd=false){try{observe('before-yield');yield 1;await Promise.resolve();observe('after-resume');if(throwAtEnd)throw new Error('generator failure');yield 2;}finally{observe('cleanup');}}
try{
 for(const mode of ['normal','return','throw']){
  const events=[];const run=await workspace.run({...options,observers:[{observe:e=>events.push(e)}]},async r=>{
   const work=r.ordinary(`iterate-${mode}`,async()=>{
    const it=values(mode==='throw');assert.deepEqual(await it.next(),{value:1,done:false});
    if(mode==='return')await it.return();else if(mode==='throw')await it.next();else{assert.deepEqual(await it.next(),{value:2,done:false});assert.deepEqual(await it.next(),{value:undefined,done:true});}
   });if(mode==='throw')await assert.rejects(work,/generator failure/);else await work;observe('parent-after-cleanup');return r;
  });
  assert.equal(run.value.open,false);await assert.rejects(run.value.ordinary('late',()=>1),e=>e.code==='run-closed');
  console.log(JSON.stringify({mode,events:events.filter(e=>e.kind==='ordinary').map(e=>({kind:e.kind,label:e.label,phase:e.phase})),observations:observations.splice(0)}));
 }
 let escaped;
 const detached=await workspace.run(options,async r=>{escaped=r;return r.ordinary('make-iterator',()=>values());});
 assert.equal(escaped.open,false);
 let escapedError;try{await detached.value.next();}catch(e){escapedError={name:e.name,code:e.code};}
 console.log(JSON.stringify({mode:'returned-iterator',runOpen:escaped.open,iteratorError:escapedError,boundary:'ordinary generic returns iterator without wrapping/owning iteration; consuming within the awaited body is the passing supported control. RUN001 requires API ownership decision for escaped lazy work.'}));
}finally{workspace.close();rmSync(dir,{recursive:true,force:true});}
