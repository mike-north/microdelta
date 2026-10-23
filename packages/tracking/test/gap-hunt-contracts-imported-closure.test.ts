/** TRK-1/2/4: unchanged imported code cannot conceal changed tracked closure configuration. */
import { expect, test } from '@jest/globals';
import { observe } from '@microdelta/value';
import { calculate, configuration, declarationObserver, importedHelper } from './gap-hunt-contracts-imported-declaration.js';

test('an imported tracked declaration needs no rewrap and unchanged helper text still invalidates for changed tracked closure facts', () => {
  let bodies = 0;
  const computation = declarationObserver.derived(() => {
    // eslint-disable-next-line microdelta/tracked-captures -- Test-only counter distinguishes cached reuse from recomputation; it is not an invalidating influence.
    bodies += 1;
    return importedHelper(3);
  });
  const initial = declarationObserver.capture(() => computation.get());
  expect(initial.value).toBe(6);
  expect(initial.observations.map(observation => observation.binding.path)).toEqual([['helper'], ['configuration']]);
  expect(bodies).toBe(1);
  expect(declarationObserver.compareCurrent(initial, { resolve(_binding, request) {
    if (request.kind === 'implementation') { return { kind: 'available', fact: calculate }; }
    if (request.kind === 'selected') { return { kind: 'available', fact: observe({ factor: 2, unread: 'changed but unconsumed' }, request.address, request.operation) }; }
    return { kind: 'unavailable' };
  } }).kind).toBe('equal');
  expect(declarationObserver.capture(() => computation.get()).value).toBe(6);
  expect(bodies).toBe(1);
  configuration.set(declarationObserver.tracked({ factor: 3, unread: 'changed but unconsumed' }, { path: ['configuration'] }));
  const changed = declarationObserver.capture(() => computation.get());
  expect(changed.value).toBe(9);
  expect(bodies).toBe(2);
  expect(changed.observations.find(observation => observation.kind === 'implementation'))
    .toEqual(initial.observations.find(observation => observation.kind === 'implementation'));
  expect(changed.observations.find(observation => observation.kind === 'fact'))
    .not.toEqual(initial.observations.find(observation => observation.kind === 'fact'));
});
