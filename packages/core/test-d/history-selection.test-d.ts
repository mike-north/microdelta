/** Finite selection exposes answers, never a caller-owned storage reader. */
import { expectError, expectType } from 'tsd';
import { readHistorySelection } from '../dist/api/microdelta.alpha.js';
import type { IHistorySelectionLocation, IHistorySelectionRequest, IHistorySelectionResult } from '../dist/api/microdelta.alpha.js';
import type { ICompletedResultReference, IHistorySelectionOptions } from '@microdelta/history';
import { readHistorySelection as readHistory } from '@microdelta/history';

declare const location: IHistorySelectionLocation;
declare const options: IHistorySelectionOptions;
declare const reference: ICompletedResultReference;
const fact: IHistorySelectionRequest = { kind: 'fact', reference, request: { operation: 'value', address: [] } };
const digest: IHistorySelectionRequest = { kind: 'fingerprint', reference, request: { kind: 'selected', operation: 'value', address: [], encoding: 'MDO1' } };
expectType<IHistorySelectionResult>(readHistorySelection(location, fact));
expectType<IHistorySelectionResult>(readHistory(options, digest));
const answer = readHistorySelection(location, fact);
if (answer.kind === 'fact') {
  expectType<'value' | 'length' | 'keys' | 'own' | 'membership' | 'container-kind'>(answer.selected.operation);
  expectError(answer.resolution);
} else {
  expectType<'compatible' | 'unavailable' | 'incompatible' | 'ambiguous'>(answer.resolution.kind);
  expectError(answer.selected);
}
expectError(answer.reader);
expectError(readHistorySelection(location, { kind: 'fact', reference }));
expectError(readHistorySelection(location, { kind: 'fingerprint', reference, request: { operation: 'value', address: [] } }));
expectError(readHistorySelection(location, { kind: 'scalar', reference, request: { operation: 'value', address: [] } }));
