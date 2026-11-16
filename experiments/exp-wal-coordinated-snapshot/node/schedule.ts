/** Exact reviewed schedules and coalesced image barriers are static inputs, never adaptive retries. */
import { record } from './peer.js';
/** A selected cell's longest permitted branch bounds all native and cleanup requests. @internal */
export interface ILedgerRow {
    readonly id: string;
    readonly launches: number;
    readonly rolesInLaunchOrder: readonly string[];
    readonly maximumProtocolCommands: number;
    readonly orderedCommands: readonly string[];
    readonly maximumImages: number;
}
/** The complete matrix stays explicit even when later cells remain unexecuted. @internal */
export interface ILedger {
    readonly rows: readonly ILedgerRow[];
}
/** Named barriers combine only the intervening recorded stages; no separate-stage claim is invented. @internal */
export const imageBarriers: Readonly<Record<string, readonly string[]>> = {
    Q1: ['R.profile', 'R.open', 'R.begin', 'R.anchor', 'R.read', 'R.runtime', 'R.end', 'R.close', 'R.exit'],
    Q2: ['W.checkpoint', 'W.commitB', 'R.open', 'R.begin', 'R.anchorB', 'W.commitC', 'R.readB', 'R.runtime', 'W.exit', 'R.close', 'R.exit', 'R2.exit'],
    Q3: ['W.checkpoint', 'W.commitB', 'R.open', 'R.begin', 'W.commitC', 'R.anchor', 'R.read', 'R.runtime', 'R.close', 'R.exit'],
    Q4: ['W.checkpoint', 'W.commitB', 'R.open', 'R.begin', 'W.holdUncommittedC', 'R.anchorB', 'W.rollbackC', 'R.readB', 'R.runtime', 'R.close', 'R.exit'],
    Q5: ['W.checkpoint', 'W.commitB', 'R.begin', 'R.runtime', 'W.commitC', 'W.checkpoint-blocked', 'W.exit', 'V.open', 'V.checkpoint-blocked', 'R.end', 'V.readC', 'R.close'],
    Q6: ['W.checkpoint', 'W.commitB', 'fixture-prepared', 'R.open', 'R.begin', 'R.anchor', 'R.read', 'R.runtime', 'R.end', 'R.close', 'R.exit', 'W.exit'],
    Q7: ['W.checkpoint', 'W.commitB', 'owner-killed', 'fixture-prepared', 'R.open', 'R.begin', 'R.anchor', 'R.read', 'R.runtime', 'R.end', 'R.close', 'R.exit'],
    Q8: ['W.checkpoint', 'W.commitB', 'owner-killed', 'fixture-prepared', 'R.open', 'R.begin-if-open', 'R.anchor-if-open', 'R.runtime-if-pair-success', 'R.status', 'R.close', 'R.exit'],
    Q9: ['W.checkpoint', 'W.commitB', 'owner-killed', 'fixture-prepared', 'R.open', 'R.begin-if-open', 'R.anchor-if-open', 'R.runtime-if-pair-success', 'R.status', 'R.close', 'R.exit'],
    Q10: ['W.exit', 'fixture-prepared', 'R.open', 'R.begin-if-open', 'R.anchor-if-open', 'R.read-if-success', 'R.runtime-if-success', 'R.end-if-success', 'R.status', 'R.close', 'R.exit'],
    Q11: ['R.profile', 'R.open', 'R.status', 'R.close', 'R.exit'],
    Q12: ['R.profile', 'R.open', 'R.begin-if-open', 'R.anchor-if-open', 'R.runtime-if-pair-success', 'R.status', 'R.close', 'R.exit'],
    Q13: ['W.exit', 'R.profile', 'R.open', 'R.begin-if-open', 'R.anchor-if-open', 'R.runtime-if-pair-success', 'R.status', 'R.close', 'R.exit'],
    Q14: ['R.profile', 'R.open', 'R.begin-if-open', 'R.anchor-if-open', 'R.runtime-if-pair-success', 'R.status', 'R.close', 'R.exit'],
    Q15: ['W.hot-seedA', 'W.hold-spilled-update', 'owner-killed', 'R.open', 'R.anchor-if-open', 'R.exit'],
    Q16: ['W.checkpoint', 'W.commitB', 'R.begin', 'R.runtime', 'W.commitC', 'W.checkpoint-blocked', 'W.exit', 'V.open', 'V.checkpoint-blocked', 'R.native-overflow-and-cleanup', 'V.readC', 'R.close'],
    Q17: ['W.checkpoint', 'W.commitB', 'R.begin', 'R.runtime', 'W.commitC', 'W.checkpoint-blocked', 'W.exit', 'V.open', 'V.checkpoint-blocked', 'R.fixed-caller-failure-and-cleanup', 'V.readC', 'R.close'],
    Q18: ['W.checkpoint', 'W.commitB', 'R.begin', 'R.runtime', 'W.commitC', 'W.checkpoint-blocked', 'W.exit', 'V.open', 'V.checkpoint-blocked', 'R.end', 'V.readC', 'R.close'],
    'C-stale': ['W.checkpoint', 'R.profile', 'R.open', 'R.begin', 'R.anchorA', 'W.commitB', 'R.readA', 'R.exit'],
    'C-torn': ['W.checkpoint', 'W.commitB', 'C.profile', 'C.open-readonly', 'C.metaB', 'W.commitC', 'C.currentC', 'C.exit'],
    'C-immediate': ['W.commitA', 'C.profile', 'C.open-writable', 'C.begin-immediate', 'W.commitB-blocked', 'C.rollback', 'W.commitB-after-release', 'C.exit'],
    'C-forbidden-effects': ['initial-baseline', 'mutated', 'fresh-reconstruction-baseline', 'transient-restored'],
    'C-false-release': ['W.checkpoint', 'W.commitB', 'C.begin', 'C.runtime', 'W.commitC', 'W.checkpoint-blocked', 'W.exit', 'V.open', 'V.checkpoint-blocked', 'C.fake-end', 'V.checkpoint-still-blocked', 'V.readC'],
};
/** Shape validation also enforces the selected totals; a larger matrix needs fresh supervisory review. @internal */
export function validateLedger(value: unknown): ILedger {
    if (!record(value) || !Array.isArray(value.rows) || value.rows.length !== 23) {
        throw new Error('Incomplete selected ledger');
    }
    const rows: ILedgerRow[] = value.rows.map((item: unknown) => {
        if (!record(item) || typeof item.id !== 'string' || typeof item.launches !== 'number' || !Array.isArray(item.rolesInLaunchOrder) || !item.rolesInLaunchOrder.every((x: unknown) => typeof x === 'string') || !Array.isArray(item.orderedCommands) || !item.orderedCommands.every((x: unknown) => typeof x === 'string') || typeof item.maximumProtocolCommands !== 'number' || typeof item.maximumImages !== 'number') {
            throw new Error('Malformed ledger row');
        }
        return { id: item.id, launches: item.launches, rolesInLaunchOrder: item.rolesInLaunchOrder, orderedCommands: item.orderedCommands, maximumProtocolCommands: item.maximumProtocolCommands, maximumImages: item.maximumImages };
    });
    if (new Set(rows.map(row => row.id)).size !== 23 || rows.some(row => row.orderedCommands.length !== row.maximumProtocolCommands || row.maximumProtocolCommands > 31 || row.maximumImages > 12 || row.launches !== row.rolesInLaunchOrder.length || !imageBarriers[row.id] || (imageBarriers[row.id]?.length ?? Infinity) > row.maximumImages) || rows.reduce((n, row) => n + row.launches, 0) !== 47 || rows.reduce((n, row) => n + row.orderedCommands.length, 0) !== 414 || rows.reduce((n, row) => n + row.maximumImages, 0) !== 228) {
        throw new Error('Selected ledger bounds changed');
    }
    return { rows };
}
/** All five controls precede the once-only Q1–Q18 campaign. @internal */
export function selectedLedger(ledger: ILedger): readonly ILedgerRow[] {
    const order = ['C-stale', 'C-torn', 'C-immediate', 'C-forbidden-effects', 'C-false-release', ...Array.from({ length: 18 }, (_, index) => `Q${index + 1}`)];
    return order.map(id => {
        const row = ledger.rows.find(row => row.id === id);
        if (!row) {
            throw new Error(`Missing selected cell ${id}`);
        }
        return row;
    });
}
