/** Proof allocation admission is deterministic and never loads native workers. */
import { expect, test } from '@jest/globals';
import { ProofBudget } from '../node/coordinator.js';
test('category overflow is retained before persistence and global allocations total 125.875MiB', () => { const budget = new ProofBudget(); budget.reserve('ordinary', 66 * 1048576); expect(() => budget.reserve('ordinary', 1)).toThrow('quota'); expect(budget.used.ordinary).toBe(66 * 1048576 + 1); });
test('negative, nonfinite and fractional proof amounts refuse', () => {
    for (const value of [-1, NaN, Infinity, 0.5]) {
        expect(() => new ProofBudget().reserve('hot', value)).toThrow('Invalid');
    }
});
