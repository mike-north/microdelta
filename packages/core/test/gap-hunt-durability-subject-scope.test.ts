/** RES-001 exact subject text and analysis scope are independent durable keys. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@jest/globals';

import { authoring, openWorkspace } from '../src/index.js';

interface IInputs { readonly payload: { readonly marker: string } }
type IHelpers = Record<never, never>;
interface ICase { readonly scope: string; readonly subject: string; readonly marker: string }

/** Reconstruct author declarations and reopen History for every demand. */
async function resolve(location: string, choice: ICase, requestKey: string) {
  const builders = authoring<IInputs, IHelpers>();
  const declaration = builders.memo({ subject: choice.subject, run: ({ inputs }) => ({ marker: inputs.payload.marker }) });
  const composition = builders.compose({ scope: choice.scope, inputs: [{ slot: 'payload', value: { marker: choice.marker } }], helpers: [], steps: [{ slot: 'value', declaration }] });
  const workspace = openWorkspace({ location, logicalStore: 'opaque-subjects' });
  try {
    return await workspace.run({ authoring: builders, composition, environment: 'same' }, async (run) => {
      const outcome = await run.resolve({ scope: choice.scope, role: 'step', slot: 'value' }, { requestKey });
      if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`unexpected ${outcome.kind}`); }
      return { outcome, value: run.read<unknown>(outcome.reference) };
    });
  } finally { workspace.close(); }
}

test('same subject in distinct exact scopes and distinct exact subject strings keep independent histories after reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-opaque-subjects-'));
  const cases: readonly ICase[] = [
    { scope: 'Analysis', subject: 'shared', marker: 'upper-scope' },
    { scope: 'analysis', subject: 'shared', marker: 'lower-scope' },
    { scope: 'analysis', subject: ' shared ', marker: 'whitespace' },
    { scope: 'analysis', subject: 'Shared', marker: 'case' },
    { scope: 'analysis', subject: '\u00e9', marker: 'composed' },
    { scope: 'analysis', subject: 'e\u0301', marker: 'decomposed' },
  ];
  try {
    const location = join(directory, 'history.sqlite');
    const first = [];
    for (const [index, choice] of cases.entries()) {
      const result = await resolve(location, choice, `cold-${index}`);
      expect(result.value.outcome.kind).toBe('published');
      expect(result.value.value).toEqual({ marker: choice.marker });
      first.push(result.value.outcome.reference);
    }
    expect(new Set(first.map((reference) => reference.locator)).size).toBe(cases.length);
    for (const [index, choice] of cases.entries()) {
      const result = await resolve(location, choice, `reopen-${index}`);
      expect(result.value.outcome).toMatchObject({ kind: 'reused', reference: first[index] });
      expect(result.value.value).toEqual({ marker: choice.marker });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
