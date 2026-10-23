/** Complete executable author examples use numeric callbacks and explicit symbolic input tokens. */
import { analysis, memo } from '../src/protocol.js';
import type { IAnalysis } from '../src/protocol.js';
import { assess } from './assessment.js';
import type { IPullRequest, IScoring } from './assessment.js';
import { assessEqual } from './assessment-equal.js';
import { assessChanged } from './assessment-changed.js';

/** Application inputs include an alternative origin for correspondence migration proof. */
export interface IInputs { readonly pr: IPullRequest; readonly alternate: IPullRequest; readonly scoring: IScoring; readonly unusedNumber: number }
/** One retained numeric calculation; no author storage record is required. */
export const single = analysis<IInputs>((input) => memo({ name: 'length', from: { pr: input('pr'), unused: input('unusedNumber') }, run: ({ pr }) => pr.title.length }));
/** Imported composition produces a fixed numeric child and a numeric consuming parent. */
export const report = analysis<IInputs>((input) => {
  const score = assess('score', input('pr'), input('scoring'));
  return memo({ name: 'report', from: { score }, run: ({ score }) => score * 10 });
});
/** Only child callback code changes; adapter and parent body text remain unchanged. */
export const equalCode = analysis<IInputs>((input) => {
  const score = assessEqual('score', input('pr'), input('scoring'));
  return memo({ name: 'report', from: { score }, run: ({ score }) => score * 10 });
});
/** Changed child callback output must cross the parent dependency boundary. */
export const changedCode = analysis<IInputs>((input) => {
  const score = assessChanged('score', input('pr'), input('scoring'));
  return memo({ name: 'report', from: { score }, run: ({ score }) => score * 10 });
});
/** Body text stays fixed while the current symbolic input origin changes. */
export const rebound = analysis<IInputs>((input) => {
  const score = assess('score', input('alternate'), input('scoring'));
  return memo({ name: 'report', from: { score }, run: ({ score }) => score * 10 });
});
/** Repeated aliases select one declared child rather than duplicating its identity. */
export const aliased = analysis<IInputs>((input) => {
  const score = assess('score', input('pr'), input('scoring'));
  return memo({ name: 'report', from: { left: score, right: score }, run: ({ left, right }) => left + right });
});
/** Output observation is lazy even though declared children still resolve before this body. */
export const ignored = analysis<IInputs>((input) => {
  const score = assess('score', input('pr'), input('scoring'));
  return memo({ name: 'report', from: { score }, run: () => 7 });
});
/** Opaque subjects can be reassigned without changing structural occurrence or callback text. */
function subjects(swapped: boolean): IAnalysis<IInputs> {
  return analysis<IInputs>((input) => {
    const a = memo({ name: 'a', subject: swapped ? 'subject-y' : 'subject-x', from: { n: input('unusedNumber') }, run: ({ n }) => n });
    return memo({ name: 'b', subject: swapped ? 'subject-x' : 'subject-y', from: { n: a }, run: ({ n }) => n * 2 });
  });
}
/** Separate built graphs differ only in their complete subject association. */
const originalSubjects = subjects(false);
/** Same structural entry and runtime callbacks, exchanged opaque subjects. */
const swappedSubjects = subjects(true);
/** Select only among explicit proof variants; the caller does not synthesize runtime topology. */
export function entryFor(scenario: string, mode: string): IAnalysis<IInputs> {
  return mode === 'subjects' ? (scenario === 'swapped' ? swappedSubjects : originalSubjects) : mode === 'aliased' ? aliased : mode === 'ignored' ? ignored : mode === 'single' ? single : scenario === 'callback-equal' ? equalCode : scenario === 'callback-changed' ? changedCode : scenario === 'rebound' ? rebound : report;
}
