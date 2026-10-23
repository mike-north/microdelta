/** Mutation control keeps the unjustified-origin assertion dependent on real constructor rejection. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { expect } from 'expect';

/** Run exactly the checked-in assertion body against an isolated protocol implementation. */
async function checkForgedOrigin(source) {
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const { analysis, memo } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const tests = await readFile(new URL('../experiments/exp-authoring/test/protocol.test.ts', import.meta.url), 'utf8');
  const start = tests.indexOf('    expect(', tests.indexOf("test('forged and cross-analysis"));
  const end = tests.indexOf('    const holder:', start);
  assert.ok(start >= 0 && end > start, 'Expected the bounded forged-origin assertion');
  // The extracted fixture is trusted checked-in JavaScript syntax. Running it
  // unchanged is what detects fallback messages that accidentally satisfy it.
  const assertion = ts.transpileModule(tests.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  new Function('analysis', 'memo', 'expect', assertion)(analysis, memo, expect);
}

test('the forged-origin negative rejects a mutant that accepts its unjustified token', async () => {
  const source = await readFile(new URL('../experiments/exp-authoring/src/protocol.ts', import.meta.url), 'utf8');
  const needle = "const origin = token !== null && typeof token === 'object' ? owner.origins.get(token) : undefined;";
  const replacement = "const origin = (token !== null && typeof token === 'object' ? owner.origins.get(token) : undefined) ?? (name === 'forged' ? { kind: 'input', slot: 'forged' } : undefined);";
  assert.ok(source.includes(needle), 'Expected owned-origin validation mutation site');
  await checkForgedOrigin(source);
  await assert.rejects(checkForgedOrigin(source.replace(needle, replacement)), /toThrow|throw/i);
});
