/** Probe-owned cleanup must preserve the first thrown object and attempt every handle release in declared order. */
import { expect, test } from '@jest/globals';

import { finishOwned } from './lifetime.js';

test('successful owned closure attempts every synchronous release in order', () => {
  const calls: string[] = [];
  expect(finishOwned([() => { calls.push('end'); }, () => { calls.push('reader'); }, () => { calls.push('writer'); }])).toEqual({ kind: 'closed' });
  expect(calls).toEqual(['end', 'reader', 'writer']);
});
test('end failure remains primary while both later releases are attempted and their failures stay distinct', () => {
  const primary = Object.freeze({ failure: 'end' }); const later = Object.freeze({ failure: 'reader' }); const last = Object.freeze({ failure: 'writer' });
  const calls: string[] = [];
  const result = finishOwned([() => { calls.push('end'); throw primary; }, () => { calls.push('reader'); throw later; }, () => { calls.push('writer'); throw last; }]);
  expect(calls).toEqual(['end', 'reader', 'writer']); expect(result.kind).toBe('failed');
  if (result.kind !== 'failed') { throw new Error('Expected measured cleanup failures'); }
  expect(result.primary).toBe(primary); expect(result.secondary[0]).toBe(later); expect(result.secondary[1]).toBe(last);
});
test('a thrown undefined is still a failure rather than a successful close sentinel', () => {
  const result = finishOwned([() => { throw undefined; }]);
  expect(result).toEqual({ kind: 'failed', primary: undefined, secondary: [] });
});
