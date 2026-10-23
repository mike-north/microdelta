/** Static source/API diagnostic for ARC-008; this does not execute or fake recursive child resolution. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';

const paths = ['docs/spec/architecture.md', 'packages/resolution/src/contracts.ts', 'packages/resolution/dist/api/resolution.alpha.d.ts', 'packages/resolution/src/resolution.ts', 'packages/core/test/resolution/support.ts', 'packages/core/test/nested/support.ts', 'packages/resolution/test/outcome.test.ts'];
const sources = Object.fromEntries(await Promise.all(paths.map(async file => [file, await readFile(file, 'utf8')])));
function parsed(file) { return ts.createSourceFile(file, sources[file], ts.ScriptTarget.Latest, true); }
function options(file) {
  const declaration = parsed(file).statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'IResolutionOptions');
  assert.ok(declaration, `Missing options interface in ${file}`);
  return declaration.members.map(member => member.name?.getText()).filter(Boolean);
}
const sourceOptions = options(paths[1]);
const emittedOptions = options(paths[2]);
assert.deepEqual(sourceOptions, emittedOptions, 'Generated-alpha surface differs from owning source');
assert.deepEqual(sourceOptions, ['declarations', 'composition', 'bindings', 'environment', 'history', 'tracking', 'host', 'admission', 'observer', 'execution']);
const engine = parsed(paths[3]);
const constructor = engine.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createResolution');
assert.ok(constructor?.body);
const recursiveFunctions = constructor.body.statements.filter(ts.isFunctionDeclaration).map(node => node.name?.text).filter(name => ['resolveSourceShared', 'resolveMemoShared', 'resolveSuppliedShared', 'resolveStep'].includes(name));
assert.equal(recursiveFunctions.length, 4, 'Expected the actual lexical child-resolution routes');
assert.ok(sources[paths[0]].includes('resolution tests using fake current facts, source policies and child resolvers;'));
assert.ok(sources[paths[3]].includes('return Object.freeze({\n    async resolve(request: IResolveRequest)'));
const calls = [];
function visit(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && recursiveFunctions.includes(node.expression.text)) calls.push({ callee: node.expression.text, line: engine.getLineAndCharacterOfPosition(node.getStart(engine)).line + 1 });
  ts.forEachChild(node, visit);
}
visit(constructor);
assert.ok(calls.some(call => call.callee === 'resolveSourceShared'));
assert.ok(calls.some(call => call.callee === 'resolveMemoShared'));
assert.ok(calls.some(call => call.callee === 'resolveSuppliedShared'));
const result = {
  kind: 'static-source-and-generated-alpha-diagnostic',
  productionBaseline: 'c5802daca4a0bb8ea91159854d84eddcfa5215b6',
  sourceOptions, emittedOptions, recursiveFunctions, recursiveCalls: calls,
  limits: 'This enumerates the actual construction surface and lexical recursive routes. It does not invent an option name, execute a fake child resolver, or infer a runtime defect. The literal validation judgment is documented in ARC-008-LITERAL.md.',
  sha256: Object.fromEntries(paths.map(file => [file, createHash('sha256').update(sources[file]).digest('hex')])),
};
await writeFile('scratch/gap-hunt/contracts/arc008-surface.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ sourceOptions, recursiveFunctions, recursiveCallSites: calls.length, staticOnly: true }));
