/** Probe concrete literal spellings against the same prohibited History source. */
import {ESLint} from 'eslint';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const eslint=new ESLint({cwd:process.cwd(),overrideConfigFile:'tooling/context-imports.config.mjs'});
const importer=path.resolve('examples/contribution-report/src/probe.ts');
const target=path.resolve('packages/history/src/index.js');
const file=pathToFileURL(target).href;
const specs=[target,file,'./%2e%2e/%2e%2e/%2e%2e/packages/history/src/index.js'];
const rows=[];
for(const specifier of specs){for(const syntax of ['static','dynamic']){
 const source=syntax==='static'?`import {openDurableHistory} from '${specifier}';`:`void import('${specifier}');`;
 const [result]=await eslint.lintText(source,{filePath:importer});
 rows.push({syntax,specifier,source,resolvedNodeURL:new URL(specifier,pathToFileURL(importer)).href,targetURL:file,errors:result.messages.filter(m=>m.severity===2)});
}}
for(const source of ["type IX=import('@microdelta/history');","const h=require('@microdelta/history');"]){const [result]=await eslint.lintText(source,{filePath:importer});rows.push({source,errors:result.messages.filter(m=>m.severity===2)});}
console.log(JSON.stringify(rows.map(row=>({ ...row,source:row.source.replaceAll(process.cwd(),'<workspace>'),specifier:row.specifier?.replaceAll(process.cwd(),'<workspace>'),resolvedNodeURL:row.resolvedNodeURL?.replaceAll(process.cwd(),'<workspace>'),targetURL:row.targetURL?.replaceAll(process.cwd(),'<workspace>') })),null,2));
