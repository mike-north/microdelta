/** Portable literal oracles keep fixture health, native release and coverage distinct. */
/** Two singleton rows must belong to one literal committed revision. @internal */
export interface IPair {
    readonly revision: number;
    readonly currentRevision: number;
    readonly value: string;
}
/** Release is observed only through a preexisting lock constraint and a living reader's ended native transaction. @internal */
export interface IRelease {
    readonly beforeBusy: number;
    readonly afterBusy: number;
    readonly readerAlive: boolean;
    readonly nativeTransaction: boolean;
    readonly naturalExit: boolean;
    readonly expectedC: boolean;
}
/** Every selected cell stays visible, including unexecuted and unsupported profiles. @internal */
export interface ICell {
    readonly id: string;
    readonly outcome: 'observed' | 'counterexample' | 'unsupported' | 'unavailable' | 'unproved';
    readonly pins?: boolean;
    readonly cleanup?: boolean;
    readonly measurement?: boolean;
    readonly limitation?: string;
}
/** A literal oracle rejects torn pairs and stale values independently of mechanism assertions. @internal */
export function pairMatches(pair: IPair, value: string): boolean { const revision = ['A', 'B', 'C', 'D'].indexOf(value) + 1; return revision > 0 && pair.revision === revision && pair.currentRevision === revision && pair.value === value; }
/** Native facts cannot be replaced with an adapter's claimed ended flag. @internal */
export function releaseObserved(value: IRelease): boolean { return value.beforeBusy > 0 && value.afterBusy === 0 && value.readerAlive && !value.nativeTransaction && value.naturalExit && value.expectedC; }
/** Optional compatibility limitations never excuse mandatory missing evidence. @internal */
export const mandatory = ['C-stale', 'C-torn', 'C-immediate', 'C-forbidden-effects', 'C-false-release', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q7', 'Q11', 'Q12', 'Q13', 'Q14', 'Q15', 'Q16', 'Q17', 'Q18'] as const;
/** Coverage, pin integrity, measurement and actual cleanup are necessary for any bounded PASS. @internal */
export function classify(cells: readonly ICell[]): 'PASS' | 'REJECT' | 'INCONCLUSIVE' {
    if (cells.some(cell => cell.outcome === 'counterexample')) {
        return 'REJECT';
    }
    if (new Set(cells.map(cell => cell.id)).size !== cells.length || cells.length !== 23 || cells.some(cell => ![...mandatory, 'Q6', 'Q8', 'Q9', 'Q10'].some(id => id === cell.id))) {
        return 'INCONCLUSIVE';
    }
    if (mandatory.some(id => !cells.some(cell => cell.id === id && cell.outcome === 'observed'))) {
        return 'INCONCLUSIVE';
    }
    return cells.every(cell => cell.pins && cell.cleanup && cell.measurement && cell.outcome !== 'unproved') ? 'PASS' : 'INCONCLUSIVE';
}
