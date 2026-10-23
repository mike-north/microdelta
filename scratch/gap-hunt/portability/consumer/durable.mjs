import {authoring,openWorkspace} from "microdelta";
let calls=0;
const a=authoring();
const value=a.memo({subject:"value",run:()=>{calls++;return {text:"retained"};}});
const composition=a.compose({scope:"portability",inputs:[],helpers:[],steps:[{slot:"value",declaration:value}]});
const location=new URL("./history.sqlite",import.meta.url).pathname;
try {const w=openWorkspace({location,logicalStore:"portability"});try{const result=await w.run({authoring:a,composition,environment:"fixture"},run=>run.resolve({scope:"portability",role:"step",slot:"value"},{requestKey:`request:${Date.now()}`}));console.log(JSON.stringify({node:process.version,calls,outcome:result.value}));}finally{w.close();}}
catch(e){console.error(e.name,e.message);process.exitCode=1;}
