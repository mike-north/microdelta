/** Diagnostic cause selection must not change admission, clocks, termination or cleanup behavior. */
import { expect, test } from '@jest/globals';
import { caseBoundaryReason } from '../node/deadline.js';

test('an unknown-effect stop before the deadline keeps its actual disposition reason', () => {
    const state = { expired: false, stopped: true, reason: 'Unknown physical effect requires root disposition' };
    expect(caseBoundaryReason(state, 5658, 20000)).toBe(state.reason);
    expect(state).toEqual({ expired: false, stopped: true, reason: 'Unknown physical effect requires root disposition' });
});
test('elapsed or sticky expiration still reports the deadline, even when another stop is present', () => {
    expect(caseBoundaryReason({ expired: false }, 20000, 20000)).toBe('Case/coordinator deadline exhausted');
    expect(caseBoundaryReason({ expired: true, stopped: true, reason: 'unknown effect' }, 1, 20000)).toBe('Case/coordinator deadline exhausted');
});
test('a cause-free explicit stop is distinguished from an exhausted deadline', () => {
    expect(caseBoundaryReason({ expired: false, stopped: true }, 1, 20000)).toBe('Case/coordinator stopped');
});
test('the exact old stop predicate remains unchanged across boundary states', () => {
    for (const expired of [false, true]) {
        for (const stopped of [undefined, false, true]) {
            for (const elapsed of [0, 19999, 20000, 20001]) {
                const state = { expired, ...(stopped === undefined ? {} : { stopped }) };
                expect(caseBoundaryReason(state, elapsed, 20000) !== undefined).toBe(expired || stopped === true || elapsed >= 20000);
            }
        }
    }
});
