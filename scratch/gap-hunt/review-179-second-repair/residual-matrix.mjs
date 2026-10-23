/** PKG-004/007.5/008: literal ESM URL spellings must share the same source boundary. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ESLint} from 'eslint';
const eslint=new ESLint({cwd:process.cwd(),overrideConfigFile:'tooling/context-imports.config.mjs'});
const importer='examples/contribution-report/src/probe.ts';
const rows=[];
for(const [specifier,allowed,target] of [
 ['../../../packages/history/src/index.js',false,'packages/history/src/index.js'],
 ['./%2e%2e/%2e%2e/%2e%2e/packages/history/src/index.js',false,'packages/history/src/index.js'],
 ['./local.js',true,'examples/contribution-report/src/local.js'],
 ['./%2e/local.js',true,'examples/contribution-report/src/local.js'],
]){
 const resolved=import.meta.resolve(specifier,pathToFileURL(path.resolve(importer)).href);
 assert.equal(path.relative(process.cwd(),fileURLToPath(resolved)),target,'Node ESM resolution must reach the exact fixture target');
 const source=`void import('${specifier}');`;
 const [result]=await eslint.lintText(source,{filePath:importer});assert.ok(result);
 const errors=result.messages.filter(message=>message.severity===2).map(({ruleId,messageId,message})=>({ruleId,messageId,message}));
 rows.push({importer,source,specifier,expected_allowed:allowed,node_resolved_target:target,errors,passes_boundary:(errors.length===0)===allowed});
}
const failed=rows.filter(row=>!row.passes_boundary).length;
console.log(JSON.stringify({source_pin:process.env.REVIEW_SOURCE_PIN??'unspecified',cases:rows.length,passed:rows.length-failed,failed,rows},null,2));
if(!process.argv.includes('--diagnostic'))assert.equal(failed,0,'Equivalent literal ESM paths must not bypass the forbidden source boundary');
