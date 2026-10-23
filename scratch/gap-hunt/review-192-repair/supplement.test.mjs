/** Successful nested undefined is an owned field in a supported record, distinct from skipped/no-data. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@jest/globals';
import Database from 'better-sqlite3';
import { authoring, openWorkspace } from '../../../packages/core/dist/src/index.js';

test('a skipped member has no result while a successful present-undefined record publishes and reads its own field', async () => {
 const directory=mkdtempSync(join(tmpdir(),'microdelta-root-skip-'));
 const api=authoring(); let bodies=0;
 const source=api.source({subject:'listing',collection:{identity:'key'},run:({outcome})=>outcome.fresh({status:'complete',members:[{key:'yes',required:true},{key:'no',required:false}]})});
 const template=api.template({slot:'member',collection:source,gate:({member})=>member.required,steps:member=>({value:member.memo({subject:member.subject('value'),run:()=>{bodies++;return {value:undefined};}})})});
 const composition=api.compose({scope:'undefined',steps:[{slot:'listing',declaration:source}],templates:[template]});
 const workspace=openWorkspace({location:join(directory,'history.sqlite'),logicalStore:'undefined'});
 try {
  await workspace.run({authoring:api,composition,environment:'fixture'},async run=>{
   const report=await run.resolveMembers({template:'member',step:'value'},{requestKey:'undefined'});
   const yes=report.members.find(member=>member.key==='yes'); const no=report.members.find(member=>member.key==='no');
   assert.equal(yes.status,'succeeded');assert.equal(no.status,'skipped');
   assert.equal(Object.hasOwn(no,'outcome'),false);
   const data=run.read(yes.outcome.reference);assert.equal(Object.hasOwn(data,'value'),true);assert.equal(data.value,undefined);
  });
  assert.equal(bodies,1);
 } finally {workspace.close();rmSync(directory,{recursive:true,force:true});}
});

/** The broad object type constraint never grants runtime native/class/callable publication authority. */
for (const [name,value] of [['date',new Date(0)],['function',()=>3],['nested-function',{value:()=>3}]]) {
 for (const kind of ['source','memo']) {
  test(`${kind} unsupported ${name} still rejects without publication`,async()=>{
   const directory=mkdtempSync(join(tmpdir(),'microdelta-root-native-'));const api=authoring();
   const declaration=kind==='source'?api.source({subject:'invalid',run:({outcome})=>outcome.fresh(value)}):api.memo({subject:'invalid',run:()=>value});
   const composition=api.compose({scope:'native',steps:[{slot:'invalid',declaration}]});
   const workspace=openWorkspace({location:join(directory,'history.sqlite'),logicalStore:'native'});
   try {
    await assert.rejects(workspace.run({authoring:api,composition,environment:'fixture'},run=>run.resolve({scope:'native',role:'step',slot:'invalid'},{requestKey:'invalid'})),error=>error.code==='unsupported-result');
    const database=new Database(join(directory,'history.sqlite'),{readonly:true});
    try {assert.equal(database.prepare('SELECT COUNT(*) AS count FROM history_results').get().count,0);} finally {database.close();}
   } finally {workspace.close();rmSync(directory,{recursive:true,force:true});}
  });
 }
}

/** The full selected non-finite/negative-zero numeric domain remains supported inside a container. */
test('nested numeric atoms preserve -0, NaN, and both infinities exactly',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'microdelta-root-numeric-'));const api=authoring();
 const values=[-0,Number.NaN,Number.POSITIVE_INFINITY,Number.NEGATIVE_INFINITY];
 const declaration=api.memo({subject:'numeric',run:()=>({values})});
 const composition=api.compose({scope:'numeric',steps:[{slot:'numeric',declaration}]});
 const workspace=openWorkspace({location:join(directory,'history.sqlite'),logicalStore:'numeric'});
 try {
  await workspace.run({authoring:api,composition,environment:'fixture'},async run=>{
   const result=await run.resolve({scope:'numeric',role:'step',slot:'numeric'},{requestKey:'numeric'});
   assert.equal(result.kind,'published');const data=run.read(result.reference);
   for(const [index,value] of values.entries())assert.equal(Object.is(data.values[index],value),true);
  });
 } finally {workspace.close();rmSync(directory,{recursive:true,force:true});}
});
