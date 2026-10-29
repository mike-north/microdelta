/** Final pin completion cannot erase sticky expiry or replace a previously established counterexample. */
import { expect, test } from '@jest/globals';
import { ExecutionScope } from '../node/deadline.js';
import { completeVerification, terminalVerdict } from '../node/completion.js';
import type { ICell } from '../src/evidence.js';
import { mandatory } from '../src/evidence.js';
/** Complete synthetic coverage isolates terminal composition from native qualification. */
function allCells(): ICell[] { return [...mandatory, 'Q6', 'Q8', 'Q9', 'Q10'].map(id => ({ id, outcome: 'observed', pins: true, cleanup: true, measurement: true })); }
for (const mode of ['on-time', 'late', 'counterexample']) {
    test(`final verification ${mode} preserves the structured invocation verdict`, async () => {
        const shared = { expired: false }, failures: unknown[] = [];
        const scope = new ExecutionScope(Date.now(), 1000, shared, () => [], failures, 'inert completion', 20);
        const cells = allCells();
        if (mode === 'counterexample') { cells[0] = { id: 'Q1', outcome: 'counterexample', pins: true, cleanup: false, measurement: false }; }
        try {
            const pinned = await completeVerification(scope, async () => { if (mode !== 'on-time') { await new Promise(resolve => setTimeout(resolve, 50)); } }, failures);
            expect(pinned).toBe(mode === 'on-time');
            expect(terminalVerdict(cells, shared, failures)).toBe(mode === 'on-time' ? 'PASS' : mode === 'late' ? 'INCONCLUSIVE' : 'REJECT');
            expect(failures.length).toBe(mode === 'on-time' ? 0 : 1);
        } finally { scope.dispose(); }
    });
}

test('sticky expiry independently refuses PASS even without a recorded asynchronous failure', () => { expect(terminalVerdict(allCells(), { expired: true }, [])).toBe('INCONCLUSIVE'); });
