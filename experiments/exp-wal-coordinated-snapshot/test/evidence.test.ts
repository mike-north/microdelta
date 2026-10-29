/** Literal result and release oracles are independent of native mechanism implementation. */
import { expect, test } from '@jest/globals';
import { pairMatches, releaseObserved, classify } from '../src/evidence.js';
test('literal coherence/currentness rejects stale and torn answers', () => {
    expect(pairMatches({ revision: 2, currentRevision: 2, value: 'B' }, 'B')).toBe(true);
    expect(pairMatches({ revision: 1, currentRevision: 1, value: 'A' }, 'B')).toBe(false);
    expect(pairMatches({ revision: 2, currentRevision: 3, value: 'C' }, 'C')).toBe(false);
});
test('release requires actual before constraint, native transaction end and different-process progress while reader alive', () => {
    const valid = { beforeBusy: 1, afterBusy: 0, readerAlive: true, nativeTransaction: false, naturalExit: true, expectedC: true };
    expect(releaseObserved(valid)).toBe(true);
    for (const change of [{ beforeBusy: 0 }, { afterBusy: 1 }, { readerAlive: false }, { nativeTransaction: true }, { naturalExit: false }, { expectedC: false }]) {
        expect(releaseObserved({ ...valid, ...change })).toBe(false);
    }
});
test('PASS cannot omit mandatory cells, controls, pins, cleanup or measurement', () => {
    expect(classify([])).toBe('INCONCLUSIVE');
    expect(classify([{ id: 'Q1', outcome: 'counterexample' }])).toBe('REJECT');
    expect(classify([{ id: 'Q9', outcome: 'unsupported' }])).toBe('INCONCLUSIVE');
});
test('complete selected evidence can PASS while explicit optional refusals remain named limitations', () => { const ids = ['C-stale', 'C-torn', 'C-immediate', 'C-forbidden-effects', 'C-false-release', ...Array.from({ length: 18 }, (_, i) => `Q${i + 1}`)]; const cells = ids.map(id => ({ id, outcome: 'observed' as const, pins: true, cleanup: true, measurement: true })); expect(classify(cells)).toBe('PASS'); expect(classify(cells.map(cell => cell.id === 'Q9' ? { ...cell, outcome: 'unsupported' as const } : cell))).toBe('PASS'); expect(classify(cells.map(cell => cell.id === 'Q7' ? { ...cell, outcome: 'unsupported' as const } : cell))).toBe('INCONCLUSIVE'); expect(classify(cells.map(cell => cell.id === 'Q1' ? { ...cell, cleanup: false } : cell))).toBe('INCONCLUSIVE'); });
test('complete mandatory proof plus unavailable optional fixtures can PASS but unresolved cleanup cannot', () => { const ids = ['C-stale', 'C-torn', 'C-immediate', 'C-forbidden-effects', 'C-false-release', ...Array.from({ length: 18 }, (_, i) => `Q${i + 1}`)]; const cells = ids.map(id => ({ id, outcome: ['Q6', 'Q8', 'Q9', 'Q10'].includes(id) ? 'unavailable' as const : 'observed' as const, pins: true, cleanup: true, measurement: true, limitation: 'profile unavailable' })); expect(classify(cells)).toBe('PASS'); expect(classify(cells.map(cell => cell.id === 'Q9' ? { ...cell, cleanup: false } : cell))).toBe('INCONCLUSIVE'); });
test('unknown cells cannot substitute for the four named optional profiles', () => { const ids = ['C-stale', 'C-torn', 'C-immediate', 'C-forbidden-effects', 'C-false-release', ...Array.from({ length: 18 }, (_, i) => `Q${i + 1}`)]; const cells = ids.map(id => ({ id: id === 'Q9' ? 'unselected-profile' : id, outcome: 'observed' as const, pins: true, cleanup: true, measurement: true })); expect(classify(cells)).toBe('INCONCLUSIVE'); });
