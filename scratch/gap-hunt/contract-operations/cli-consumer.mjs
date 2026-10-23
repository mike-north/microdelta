// Exercise the installed package's executable-discovery route without network.
// --help is only an executable-discovery control; CLI syntax remains unselected.
import {spawnSync} from 'node:child_process';
const run=spawnSync('npm',['exec','--offline','--','microdelta','--help'],{encoding:'utf8',timeout:10000});
console.log(JSON.stringify({command:'npm exec --offline -- microdelta --help',status:run.status,signal:run.signal,error:run.error?.code??null,stdout:run.stdout,stderr:run.stderr.replaceAll(process.env.HOME,'<user-home>')}));
