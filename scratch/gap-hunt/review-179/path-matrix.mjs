/** Equivalent literal paths must not bypass a forbidden source boundary (PKG-004/008). */
import assert from 'node:assert/strict';
import path from 'node:path';
import { ESLint } from 'eslint';
const eslint=new ESLint({cwd:process.cwd(),overrideConfigFile:'tooling/context-imports.config.mjs'});
const rows=[];
for(const owner of ['examples/contribution-report','packages/accounting']){
 const filePath=`${owner}/src/probe.ts`;
 for(const specifier of ['../../../packages/history/src/index.js','./../../../packages/history/src/index.js']){
  for(const syntax of ['static','dynamic']){
   const source=syntax==='static'?`import {openDurableHistory} from '${specifier}';`:`void import('${specifier}');`;
   const [result]=await eslint.lintText(source,{filePath});assert.ok(result);
   const errors=result.messages.filter(m=>m.severity===2);
   const target=path.relative(process.cwd(),path.resolve(path.dirname(filePath),specifier));
   assert.equal(target,'packages/history/src/index.js');
   rows.push({owner,filePath,syntax,specifier,source,resolved_literal_target:target,required:'diagnostic: forbidden History source bypass',errors:errors.map(({ruleId,messageId,message,line,column})=>({ruleId,messageId,message,line,column})),passes_boundary:errors.length>0});
  }
 }
}
const failed=rows.filter(r=>!r.passes_boundary);
console.log(JSON.stringify({source_pin:process.env['REVIEW_SOURCE_PIN']??'unspecified',cases:rows.length,passed:rows.length-failed.length,failed:failed.length,rows},null,2));
if(!process.argv.includes('--diagnostic'))assert.equal(failed.length,0,'Equivalent literal source paths must be refused regardless of ./ prefix');
