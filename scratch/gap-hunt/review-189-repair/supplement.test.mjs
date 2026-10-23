/** Generated facade consumers distinguish supported custom identity from malformed runtime key results. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@jest/globals';
import { authoring, openWorkspace } from '../../../packages/core/dist/src/index.js';

/** Every malformed snapshot contains a valid member first, so early admission is observable. */
for (const [name, invalid, reason] of [
  ['duplicate', 'good', 'duplicate-key'], ['undefined', undefined, 'missing-key'],
  ['empty', '', 'empty-key'], ['number', 7, 'non-string-key'], ['throwing', 'throw', 'key-function-failed'],
]) {
  test(`identity-less custom key ${name} rejects before every gate and member body`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-review189-'));
    const api = authoring();
    const calls = { gate: 0, body: 0 };
    const source = api.source({ subject: 'catalog-distinct', run: ({ outcome }) => outcome.fresh({ status: 'complete', members: [{ id: 'good' }, { id: invalid }] }) });
    const template = api.template({ slot: 'template-distinct', collection: source,
      key: member => { if (member.id === 'throw') throw new Error('private-key-marker'); return member.id; },
      gate: () => { calls.gate++; return true; },
      steps: member => ({ score: member.memo({ subject: member.subject('score'), run: () => { calls.body++; return 3; } }) }),
    });
    const composition = api.compose({ scope: 'review189', steps: [{ slot: 'collection-distinct', declaration: source }], templates: [template] });
    const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'review189' });
    try {
      const result = await workspace.run({ authoring: api, composition, environment: 'fixture' }, run => run.resolveMembers({ template: 'template-distinct', step: 'score' }, { requestKey: name }));
      assert.equal(result.value.discovery.kind, 'rejected');
      assert.equal(result.value.discovery.diagnostic.reason, reason);
      assert.equal(result.value.discovery.diagnostic.collection, 'collection-distinct');
      assert.equal(result.value.discovery.diagnostic.customKey, true);
      assert.match(result.value.discovery.diagnostic.message, /collection-distinct/);
      assert.match(result.value.discovery.diagnostic.message, /key/);
      assert.doesNotMatch(result.value.discovery.diagnostic.message, /private-key-marker/);
      assert.deepEqual(result.value.members, []);
      assert.deepEqual(calls, { gate: 0, body: 0 });
    } finally { workspace.close(); rmSync(directory, { recursive: true, force: true }); }
  });
}

test('missing strategy rejects before factory and records its available strategy diagnostic', () => {
  const api = authoring();
  const source = api.source({ subject: 'catalog-distinct', run: ({ outcome }) => outcome.fresh({ status: 'complete', members: [{ id: 1 }] }) });
  let factories = 0;
  let failure;
  try { api.template({ slot: 'template-distinct', collection: source, steps: () => { factories++; return {}; } }); }
  catch (error) { failure = error; }
  assert.equal(factories, 0);
  assert.equal(failure?.name, 'DefinitionError');
  assert.match(failure.message, /designated identity/);
  assert.match(failure.message, /`key` option/);
  assert.doesNotMatch(failure.message, /catalog-distinct/);
  console.log(JSON.stringify({ evidence: 'AC3-diagnostic-observation', message: failure.message, collectionSourceSubject: 'catalog-distinct', template: 'template-distinct' }));
});
