/** Literal-only enforcement probes against the real exact-head import configuration. */
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
const eslint=new ESLint({cwd:process.cwd(),overrideConfigFile:'tooling/context-imports.config.mjs'});
const cases=[
 ['packages/core/src/probe.ts',"void import('@microdelta/history');",true],
 ['packages/accounting/src/probe.ts',"void import('@microdelta/history');",false],
 ['packages/accounting/src/probe.ts',"void import('@microdelta/history/dist/src/index.js');",false],
 ['packages/accounting/src/probe.ts','void import(moduleName);',false],
 ['packages/definition/src/probe.ts',"void import('@microdelta/machine-node');",false],
 ['packages/machine-node/src/node/probe.ts',"void import('node:fs');",true],
 ['packages/history/src/probe.ts',"void import('node:fs');",false],
 ['examples/contribution-report/src/probe.ts',"void import('@microdelta/history');",false],
 ['examples/contribution-report/src/probe.ts',"void import('@microdelta/accounting');",false],
 ['examples/contribution-report/src/probe.ts',"void import('@microdelta/machine-node');",false],
 ['examples/contribution-report/src/probe.ts',"void import('microdelta/deep');",false],
 ['examples/contribution-report/src/probe.ts',"void import('../../../packages/history/src/index.js');",false],
 ['examples/contribution-report/src/probe.ts','void import(moduleName);',false],
 ['examples/contribution-report/src/probe.ts','void import(`microdelta`);',false],
 ['examples/contribution-report/src/probe.ts',"void import('micro'+'delta');",false],
 ['examples/contribution-report/src/probe.ts',"void import('microdelta');",true],
 ['examples/contribution-report/src/probe.ts',"void import('node:fs/promises');",true],
 ['examples/contribution-report/src/probe.ts',"void import('./local.js');",true],
 ['examples/contribution-report/src/probe.ts',"import {openDurableAccounting} from '@microdelta/accounting';",true],
 ['examples/contribution-report/src/probe.ts',"import {createNodeSqlite} from '@microdelta/machine-node';",true],
 ['examples/contribution-report/src/probe.ts',"import {createNodeMachine} from '@microdelta/machine-node';",false],
];
const results=[];
for(const [filePath,source,allowed] of cases){
 const [result]=await eslint.lintText(source,{filePath});assert.ok(result);
 const errors=result.messages.filter(m=>m.severity===2);
 assert.equal(errors.length===0,allowed,`${filePath}: ${source}`);
 results.push({filePath,source,expected_allowed:allowed,messages:result.messages});
}
// This is a pre-existing static and dynamic literal-path bypass, recorded
// separately so it cannot be mistaken for a newly introduced policy change.
for(const source of ["void import('./../../../packages/history/src/index.js');","import {openDurableHistory} from './../../../packages/history/src/index.js';"]){
 const filePath='examples/contribution-report/src/probe.ts';const [result]=await eslint.lintText(source,{filePath});
 results.push({filePath,source,observation:'dot-prefixed literal workspace bypass; evaluate independently against parent config',messages:result.messages});
}
console.log(JSON.stringify({qualified_probes:cases.length,results},null,2));
