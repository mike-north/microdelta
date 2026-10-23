// Minimal launch marker: no imports from microdelta, no database, no kill.
import {writeFileSync,readFileSync} from 'node:fs';
writeFileSync(process.env.MICRODELTA_LAUNCH_MARKER,'entered');
const value=JSON.parse(process.argv[2]==='--file'?readFileSync(process.argv[3],'utf8'):process.argv[2]);
console.log(JSON.stringify({entered:true,padding:value.padding?.length??0,steps:value.steps?.length??0}));
