import {authoring,openWorkspace} from 'microdelta';
import {fileURLToPath} from 'node:url';
let calls=0;const a=authoring();
const value=a.memo({subject:'value',run:()=>{calls++;return {text:'retained'};}});
const composition=a.compose({scope:'portability',inputs:[],helpers:[],steps:[{slot:'value',declaration:value}]});
const w=openWorkspace({location:fileURLToPath(new URL('./history.sqlite',import.meta.url)),logicalStore:'portability'});
try{const r=await w.run({authoring:a,composition,environment:'fixture'},run=>run.resolve({scope:'portability',role:'step',slot:'value'},{requestKey:`request:${Date.now()}`}));console.log(JSON.stringify({calls,outcome:r.value}));}finally{w.close();}
