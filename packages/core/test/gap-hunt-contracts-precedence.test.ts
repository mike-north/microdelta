/** Independent declared calls must be able to progress while a peer awaits its own work. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { authoring, openWorkspace } from 'microdelta';
interface IEmpty {}
interface IHelpers { readonly waitForPeer: () => Promise<void>; readonly releasePeer: () => void }

describe('gap hunt CMP-4 explicit precedence without global serialization', () => {
  test('an independent declared child releases its waiting sibling before their parent finishes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-precedence-'));
    const events: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    /** This fixture barrier is an explicit host helper; it supplies no reused data. */
    async function waitForPeer(): Promise<void> { events.push('wait'); await gate; events.push('resumed'); }
    /** Only the independent second child can satisfy the first child's prerequisite. */
    function releasePeer(): void { events.push('release'); release(); }
    const builders = authoring<IEmpty, IHelpers>();
    const waiting = builders.memo({ subject: 'waiting', run: async ({ helpers }) => {
      await helpers.waitForPeer();
      return { value: 1 };
    } });
    const independent = builders.memo({ subject: 'independent', run: ({ helpers }) => {
      helpers.releasePeer();
      return { value: 2 };
    } });
    const parent = builders.memo({ subject: 'parent', children: { waiting, independent }, run: async ({ calls }) => {
      // eslint-disable-next-line microdelta/tracked-captures -- Native Promise.all joins two declared child calls; neither reads an untracked external value.
      const [left, right] = await Promise.all([calls.waiting(), calls.independent()]);
      return { sum: left.data.value + right.data.value };
    } });
    const composition = builders.compose({ scope: 'precedence', steps: [{ slot: 'waiting', declaration: waiting }, { slot: 'independent', declaration: independent }, { slot: 'parent', declaration: parent }], helpers: [{ slot: 'waitForPeer', helper: waitForPeer }, { slot: 'releasePeer', helper: releasePeer }] });
    const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'precedence-store' });
    try {
      const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async run => {
        const settled = await run.resolve({ scope: 'precedence', role: 'step', slot: 'parent' }, { requestKey: 'concurrent-declared-children' });
        if (settled.kind !== 'published') { throw new Error(`Unexpected ${settled.kind}`); }
        return run.read<unknown>(settled.reference);
      });
      expect(result.value).toEqual({ sum: 3 });
      expect(events).toEqual(['wait', 'release', 'resumed']);
    } finally { release(); workspace.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
