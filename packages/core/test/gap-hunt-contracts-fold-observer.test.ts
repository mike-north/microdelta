/** CMP-8: a member observer outage must reject the strict request rather than describe a failed member. */
import { afterEach, expect, test } from '@jest/globals';
import { openWorkspace } from 'microdelta';
import { cleanup, freshLocation } from './durable-history/support.js';
import { composeFold, resetWorld, world } from './fold/fixture.js';
import { environment, foldCandidates, logicalStore, requestKey } from './fold/support.js';

afterEach(cleanup);

test('a pre-execution member observer failure rejects the whole strict-fold request and publishes no fold', async () => {
  resetWorld();
  const location = freshLocation();
  const fixture = composeFold();
  const workspace = openWorkspace({ location, logicalStore });
  let failures = 0;
  try {
    await expect(workspace.run({
      authoring: fixture.builders,
      composition: fixture.composition,
      environment,
      observers: [{ observe(event) {
        if (event.kind === 'step' && event.event.phase === 'verify' && event.event.step.memberKey === 'person:ben') {
          failures += 1;
          throw new Error('fixture observer unavailable');
        }
      } }],
    }, run => run.resolveFold(fixture.report, requestKey()))).rejects.toMatchObject({ code: 'observer-failure' });
    expect(failures).toBe(1);
    expect(world.log.filter(entry => entry.startsWith('report'))).toEqual([]);
    expect(foldCandidates(location)).toEqual([]);
  } finally {
    workspace.close();
  }
});
