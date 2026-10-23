/** Synthetic two-process identity control: subjects remain semantic identities while occurrence slots swap. */
import { openWorkspace } from 'microdelta';
import type { IRunEvent } from 'microdelta';
import { analysis, memo } from '../../../experiments/exp-authoring/src/protocol.js';
import { execute } from '../../../experiments/exp-authoring/src/execute.js';
interface IInputs { readonly first:number; readonly second:number }
/** Identical pure callback in both nodes and both processes. */
function value({v}:{readonly v:number}):number{return v;}
const [location,mode,requestKey]=process.argv.slice(2);
if(location===undefined||requestKey===undefined||(mode!=='cold'&&mode!=='swap'&&mode!=='fresh-subject'))throw new Error('Expected location and mode');
const entry=analysis<IInputs>(input=>{
 const a=memo({name:'a',subject:mode==='cold'?'Sa':'Sb',from:{v:input('first')},run:value});
 const b=memo({name:'b',subject:mode==='cold'?'Sb':mode==='fresh-subject'?'Sa-new':'Sa',from:{v:input('second')},run:value});
 return mode==='cold'?a:b;
});
const events:IRunEvent[]=[];
const workspace=openWorkspace({location,logicalStore:'occurrence-proof'});
try{
 const result=await execute(workspace,entry,{analysis:'occurrence:proof',environment:'test',requestKey,inputs:{first:1,second:2},observers:[{observe(event):void{events.push(event);}}]});
 console.log(JSON.stringify({mode,expected:mode==='cold'?1:2,result,events}));
}finally{workspace.close();}
