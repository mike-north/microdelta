/**
 * The fixed, framework-owned lifecycle positions a run exposes (REUSE-009).
 * They are published so the sequence is inspectable; observers see events at
 * these positions but cannot add, remove, reorder or replace them, and there
 * is no middleware that wraps verification, admission, claims, execution,
 * publication or release.
 */
import type { ILifecyclePhase } from '@microdelta/resolution';

import type { IOrdinaryPhase } from './contracts.js';

/**
 * The ordered step positions as a literal tuple. Its element union must equal
 * Resolution's phase union, so a phase added there fails to compile here until
 * it is placed in the sequence.
 * @alpha
 */
export type IStepLifecycle = readonly ['verify', 'finality', 'admit', 'refuse', 'claim', 'execute', 'publish', 'accept', 'release', 'abandon'];

/** Compile-time proof that {@link IStepLifecycle} lists every phase Resolution emits and nothing else. */
type IExactlyResolutionPhases = [Exclude<ILifecyclePhase, IStepLifecycle[number]>, Exclude<IStepLifecycle[number], ILifecyclePhase>] extends [never, never] ? true : never;
const exactlyResolutionPhases: IExactlyResolutionPhases = true;
void exactlyResolutionPhases;

/**
 * The positions of one resolved step, in the order they can occur: verify
 * candidates, evaluate current finality, decide admission (`refuse` on
 * denial), claim an attempt, execute, then publish, accept (ending a claim
 * with `release` after an explicit retention) or abandon. Before `publish`,
 * `accept`, `release` and `abandon`, an observer failure stops the affected
 * call; at those post-commit positions it is a diagnostic.
 * @alpha
 */
export const stepLifecycle: IStepLifecycle = Object.freeze([
  'verify',
  'finality',
  'admit',
  'refuse',
  'claim',
  'execute',
  'publish',
  'accept',
  'release',
  'abandon',
] as const);

/**
 * The positions of ordinary nonmemoized work: `begin` (an observer failure
 * stops the call before the work runs), then `end` or `fail` (observer
 * failures there are diagnostics).
 * @alpha
 */
export const ordinaryLifecycle: readonly IOrdinaryPhase[] = Object.freeze(['begin', 'end', 'fail']);
