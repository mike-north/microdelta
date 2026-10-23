/** Supported Value atoms compile as declared result data but must survive the assembled result boundary. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { authoring, openWorkspace, sourceOutcome } from '../src/index.js';
import type { ISourceOutcome } from '../src/index.js';

/** All of these atoms are explicitly within VAL-2's supported value domain. */
type IAtom = string | number | boolean | null | undefined;
interface IInputs { readonly config: { readonly value: IAtom } }
interface IHelpers { readonly fresh: (value: IAtom) => ISourceOutcome<IAtom> }

/** A deterministic source adapter: scalar response data is its only output. */
function fresh(value: IAtom): ISourceOutcome<IAtom> { return sourceOutcome.fresh(value); }

/** Each sample begins with an empty store, so no earlier rejection can affect another sample. */
async function resolve(value: IAtom, kind: 'source' | 'memo' | 'wrapped'): Promise<unknown> {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-scalar-root-'));
  const builders = authoring<IInputs, IHelpers>();
  const source = builders.source<IAtom>({ subject: 'scalar-source', run: ({ inputs, helpers }) => helpers.fresh(inputs.config.value) });
  const memo = builders.memo({ subject: 'scalar-memo', run: ({ inputs }) => inputs.config.value });
  const wrapped = builders.memo({ subject: 'wrapped-memo', run: ({ inputs }) => ({ value: inputs.config.value }) });
  const composition = builders.compose({
    scope: 'scalar-root-analysis', inputs: [{ slot: 'config', value: { value } }], helpers: [{ slot: 'fresh', helper: fresh }],
    steps: [{ slot: 'source', declaration: source }, { slot: 'memo', declaration: memo }, { slot: 'wrapped', declaration: wrapped }],
  });
  const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'scalar-root-store' });
  try {
    const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async (run) => {
      const outcome = await run.resolve({ scope: 'scalar-root-analysis', role: 'step', slot: kind }, { requestKey: 'first' });
      if (outcome.kind !== 'published') { throw new Error(`Unexpected ${outcome.kind}`); }
      return run.read<unknown>(outcome.reference);
    });
    return result.value;
  } finally {
    workspace.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('gap hunt typed scalar result boundary', () => {
  const samples: readonly { readonly kind: 'memo' | 'source'; readonly atom: IAtom }[] = ['serialized dependency', 1, true, null, undefined]
    .flatMap((atom) => [{ kind: 'memo' as const, atom }, { kind: 'source' as const, atom }]);
  test.each(samples)('$kind accepts $atom at its result root', async ({ kind, atom }) => {
    await expect(resolve(atom, kind)).resolves.toBe(atom);
  });

  test.each(['serialized dependency', 1, true, null, undefined])('record-wrapped %s positive control', async (value) => {
    await expect(resolve(value, 'wrapped')).resolves.toEqual({ value });
  });
});
