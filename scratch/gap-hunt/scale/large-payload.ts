import { performance } from 'node:perf_hooks';
import { statSync } from 'node:fs';
import { authoring, openWorkspace } from 'microdelta';
import { encodeSnapshot } from '@microdelta/value';

/** Report independent samples rather than folding setup into a misleading mean. */
for (const size of [1000, 2000, 4000, 8000, 16000]) {
  const data = Array.from({ length: size }, (_, index) => index);
  const start = performance.now();
  const encoded = encodeSnapshot(data);
  console.log(JSON.stringify({ probe: 'encode-array', size, bytes: encoded.length, milliseconds: performance.now() - start }));
}
interface IInputs { readonly size: number }
interface IRecord { readonly key: string; readonly title: string; readonly body: string }
for (const size of [20000]) {
  const data = Array.from({ length: size }, (_, index) => ({ key: `pr:${index}`, title: `Title ${index}`, body: 'x'.repeat(512) }));
  const api = authoring<IInputs, Record<string, never>>();
  const source = api.source<readonly IRecord[]>({ subject: 'payload', run: ({ inputs, outcome }) => outcome.fresh<readonly IRecord[]>(Array.from({ length: inputs.size }, (_, index) => ({ key: `pr:${index}`, title: `Title ${index}`, body: 'x'.repeat(512) }))) });
  const start = performance.now();
  const composition = api.compose({ scope: 'scale', inputs: [{ slot: 'size', value: size }], steps: [{ slot: 'payload', declaration: source }] });
  const file = `scratch/gap-hunt/scale/payload-${size}-${process.pid}.sqlite`;
  const workspace = openWorkspace({ location: file, logicalStore: `scale-${size}`, leaseMilliseconds: 600000 });
  await workspace.run({ authoring: api, composition, environment: 'synthetic' }, (run) => run.resolve({ scope: 'scale', role: 'step', slot: 'payload' }, { requestKey: 'publish' }));
  workspace.close();
  console.log(JSON.stringify({ probe: 'publish', size, payloadBytes: JSON.stringify(data).length, fileBytes: statSync(file).size, milliseconds: performance.now() - start }));
}
