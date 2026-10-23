/** A locally supplied function named require creates no module edge. */
import assert from 'node:assert/strict';
import {ESLint} from 'eslint';
const eslint=new ESLint({cwd:process.cwd(),overrideConfigFile:'tooling/context-imports.config.mjs'});
const source="export const label = (require: (value: string) => string): string => require('../../../packages/history/src/index.js');";
const [result]=await eslint.lintText(source,{filePath:'examples/contribution-report/src/probe.ts'});assert.ok(result);
const errors=result.messages.filter(m=>m.severity===2).map(({ruleId,messageId,message})=>({ruleId,messageId,message}));
console.log(JSON.stringify({source,expected:'ordinary local function call: no module edge',errors},null,2));
assert.equal(errors.length,0,'A lexical parameter named require must not become an imported module edge');
