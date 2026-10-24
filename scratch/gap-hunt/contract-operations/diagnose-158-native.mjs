// Disposable host-specific native diagnosis. No driver, policy or global changes.
// Diagnostic completion exits0 even when npm/build/smoke fails; results carry the
// actual status/signal. Infrastructure failures are reported as observations too.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
if(!process.versions.node.startsWith('26.'))throw new Error('Select Node26 on PATH for this pinned native diagnostic');
const directory=mkdtempSync(join(tmpdir(),'microdelta-158-native-'));
const clean=text=>String(text??'').replaceAll(directory,'<probe>').replaceAll(homedir(),'<user-home>');
const capture=result=>({status:result.status,signal:result.signal,error:result.error?clean(result.error.message):null,stdout:clean(result.stdout),stderr:clean(result.stderr)});
try{
 writeFileSync(join(directory,'package.json'),JSON.stringify({name:'microdelta-native-diagnostic',private:true,type:'module',dependencies:{'better-sqlite3':'12.9.0'}}));
 const npm=spawnSync('npm',['--version'],{encoding:'utf8'});
 const install=spawnSync('npm',['install','--no-audit','--no-fund'],{cwd:directory,encoding:'utf8',timeout:300000,maxBuffer:16*1024*1024});
 let smoke=null;
 if(install.status===0){
  writeFileSync(join(directory,'smoke.mjs'),"import assert from 'node:assert/strict';import Database from 'better-sqlite3';const db=new Database(':memory:');try{assert.deepEqual(db.prepare('SELECT 1 AS value').get(),{value:1});console.log('native-sqlite-open-query-ok');}finally{db.close();}");
  smoke=capture(spawnSync(process.execPath,['smoke.mjs'],{cwd:directory,encoding:'utf8',timeout:30000}));
 }
 console.log(JSON.stringify({provenance:'current native diagnostic execution',node:process.version,modulesABI:process.versions.modules,platform:process.platform,arch:process.arch,npm:capture(npm),dependency:'better-sqlite3@12.9.0',install:capture(install),smoke,interpretation:'Host-specific observed result only. Declared engine range does not determine runtime compatibility. No microdelta full-suite or cross-version store test is performed.'},null,2));
}finally{rmSync(directory,{recursive:true,force:true});}
