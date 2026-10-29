/** Adjacent image boundaries delimit attachment authority independently of the ending capture phase. */
import type { IEstablishedLayout, IEffectStageContext } from './effects-policy.js';
import { assessCell } from './oracle.js';
import type { IStageRecord } from './oracle.js';
/** The caller supplies reached records and the exact preceding image cut; no earlier case activity grants interval authority. @internal */
export interface IEffectIntervalInput {
    readonly caseId: string;
    readonly captureLabel: string;
    readonly stages: readonly string[];
    readonly beforeRecordCount: number;
    readonly records: readonly IStageRecord[];
    readonly expectedStages: readonly string[];
    readonly fixtureReady: boolean;
    readonly layout: IEstablishedLayout;
}
/** Preserve the real capture phase while distinguishing a proved attachment opportunity within these adjacent images. @internal */
export function effectIntervalContext(input: IEffectIntervalInput): IEffectStageContext {
    const action = input.captureLabel.slice(input.captureLabel.indexOf('.') + 1).replace(/-if-(?:open|pair-success|success)$/u, '');
    const stage: IEffectStageContext['stage'] = action.startsWith('open') ? 'open' : action.startsWith('begin') ? 'begin' : action.startsWith('anchor') ? 'anchor' : action.startsWith('read') ? 'read' : action.startsWith('runtime') ? 'runtime' : action.startsWith('end') ? 'end' : action.startsWith('close') ? 'close' : 'exit';
    const readerOnly = input.stages.every(value => /^(?:R|R2)\./u.test(value) || input.caseId === 'C-false-release' && value.startsWith('C.'));
    const context = { readerOnly, stage, firstAttachment: false };
    if (!readerOnly || input.layout.kind !== 'healthy-wal' || input.layout.ownership === 'live-owner' || !Number.isSafeInteger(input.beforeRecordCount) || input.beforeRecordCount < 0 || input.beforeRecordCount >= input.records.length || input.stages.at(-1) !== input.captureLabel) { return context; }
    const interval = input.records.slice(input.beforeRecordCount);
    if (interval.length !== input.stages.length || interval.some((entry, index) => entry.stage !== input.stages[index])) { return context; }
    const prefix = assessCell(input.caseId, input.records, [], false, input.expectedStages, input.fixtureReady);
    // Q13's expected failed fixed query is an opportunity, never a successful or generally valid native prefix.
    const refusal = prefix.q13RefusalAttachmentIndex;
    const q13Opportunity = input.caseId === 'Q13' && input.layout.ownership === 'closed-clean' && input.layout.databasePages <= 2 && refusal !== null && refusal >= input.beforeRecordCount && refusal < input.records.length && input.records[refusal]?.stage === 'R.anchor-if-open';
    if (!prefix.causalPrefixProved && !q13Opportunity) { return context; }
    const firstAttachment = q13Opportunity || interval.some(entry => {
        const action = entry.stage.slice(entry.stage.indexOf('.') + 1).replace(/-if-(?:open|pair-success|success)$/u, '');
        return entry.reply.kind === 'ok' && (action === 'open' || action === 'begin' || action.startsWith('anchor'));
    });
    return { ...context, firstAttachment };
}
