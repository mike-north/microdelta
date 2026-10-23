/** Mechanical check for the issue's six-file documentation-only boundary. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const base = '52e3786516a404e3433bef03807a027c8103786c';
const paths = ['README.md','docs/native-store-locations.md','examples/contribution-report/README.md','packages/core/README.md','packages/core/src/workspace.ts','packages/machine-node/src/index.ts'];
const diff = execFileSync('git',['-c','core.fsmonitor=false','diff','--name-only',base,'e42e31b7e618222e8a57b67d94b88b51e0c4e14b'],{encoding:'utf8'}).trim().split('\n').sort();
assert.deepEqual(diff, [...paths].sort());
function tokens(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const found = [];
  while(scanner.scan() !== ts.SyntaxKind.EndOfFileToken) found.push([scanner.getToken(),scanner.getTokenText()]);
  return found;
}
for(const path of paths.filter(path => path.endsWith('.ts'))) {
  const before = execFileSync('git',['show',`${base}:${path}`],{encoding:'utf8'});
  assert.deepEqual(tokens(readFileSync(path,'utf8')),tokens(before),`${path} runtime tokens changed`);
}
const links=[];
for(const path of ['README.md','packages/core/README.md','examples/contribution-report/README.md']) {
  const targets=[...readFileSync(path,'utf8').matchAll(/\[[^\]]*\]\(([^)#]+\.md)(?:#[^)]*)?\)/gu)].map(match=>resolve(dirname(path),match[1]));
  const target=resolve('docs/native-store-locations.md');
  assert(targets.includes(target) && existsSync(target),`${path} must directly link the guide`);
  links.push({entry:path,target:'docs/native-store-locations.md'});
}
console.log(JSON.stringify({source:'e42e31b7e618222e8a57b67d94b88b51e0c4e14b',files:diff,runtimeTokensUnchanged:true,links}));
