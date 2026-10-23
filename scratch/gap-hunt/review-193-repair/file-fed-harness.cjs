/** Test-only transport control: preserve the production test worker and all
 * original assertions, but send its JSON fixture through a file. No database,
 * fault schedule, expected trace or runtime implementation is changed. */
const childProcess = require('node:child_process');
const {syncBuiltinESMExports} = require('node:module');
const {mkdtempSync,writeFileSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join,resolve} = require('node:path');
const original = childProcess.spawnSync;
const worker = resolve('packages/core/.test-build/test/durable-history/worker.js');
const fileWorker = resolve('scratch/gap-hunt/review-193-repair/file-worker.mjs');
childProcess.spawnSync = function(command,args,options) {
 if (command !== process.execPath || !Array.isArray(args) || args[0] !== worker || typeof args[1] !== 'string') return original(command,args,options);
 const dir=mkdtempSync(join(tmpdir(),'microdelta-worker-transport-'));
 try {const file=join(dir,'script.json');writeFileSync(file,args[1]);return original(command,[fileWorker,file,...args.slice(2)],options);}
 finally {rmSync(dir,{recursive:true,force:true});}
};
syncBuiltinESMExports();
