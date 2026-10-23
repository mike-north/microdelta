import { performance } from 'node:perf_hooks';
import { AsyncResource } from 'node:async_hooks';
import { authoring, openWorkspace } from 'microdelta';

const isolated = process.argv.includes('--isolated');
const freshSource = process.argv.includes('--fresh-source');
const api = authoring<Record<string, never>, Record<string, never>>();
const source = api.source<{ readonly value: number }>({ subject: 'constant', run: ({ outcome }) => outcome.fresh({ value: 42 }), finality: () => true });
const composition = api.compose({ scope: 'contexts', steps: [{ slot: 'source', declaration: source }] });
const workspace = openWorkspace({ location: `scratch/gap-hunt/scale/context-${freshSource ? 'fresh-source' : 'reuse'}-${isolated ? 'isolated' : 'plain'}-${process.pid}.sqlite`, logicalStore: 'contexts' });
try {
  for (let batch = 0; batch < 20; batch += 1) {
    const start = performance.now();
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const freshApi = authoring<Record<string, never>, Record<string, never>>();
      const fresh = freshApi.source<{ readonly value: number }>({ subject: `constant:${batch}:${iteration}`, run: ({ outcome }) => outcome.fresh({ value: 42 }), finality: () => true });
      const freshComposition = freshApi.compose({ scope: 'contexts', steps: [{ slot: 'source', declaration: fresh }] });
      const work = (): Promise<unknown> => workspace.run({ authoring: freshSource ? freshApi : api, composition: freshSource ? freshComposition : composition, environment: 'synthetic' }, async (run) => {
        await run.resolve({ scope: 'contexts', role: 'step', slot: 'source' }, { requestKey: 'same' });
        for (let tick = 0; tick < 100; tick += 1) await Promise.resolve();
      });
      if (isolated) {
        const resource = new AsyncResource('gap-hunt-independent-run');
        try { await resource.runInAsyncScope(work); } finally { resource.emitDestroy(); }
      } else { await work(); }
    }
    global.gc?.();
    console.log(JSON.stringify({ probe: 'context', isolated, freshSource, batch, runs: (batch + 1) * 100, milliseconds: performance.now() - start, heap: process.memoryUsage().heapUsed, rss: process.memoryUsage().rss }));
  }
} finally { workspace.close(); }
