/**
 * The M5 paid-like analysis as an acceptance worker process authors it
 * through the built `microdelta` facade's alpha surface. Each process calls
 * `composeAnalysis()` afresh, so nothing survives a process exit but the
 * durable History and Accounting stores and the files the parent wrote:
 * declarations, callbacks, helpers and inputs are all newly allocated.
 *
 * - `prs` is a composition-level keyed collection source. Its check discovers
 *   the pull requests the *world file* lists (the stand-in for a live
 *   upstream API), keyed by designated identity `key` (`pr-1`). The listing
 *   is final once taken.
 * - `pr` is a fanout template over that collection with one member memo,
 *   `assess`, whose body makes exactly one paid-like external operation
 *   through `currentExecution().operation` (each paid call isolated in its
 *   own step, EXP-8 resolution 3). The operation is named `assess`; its
 *   binding is a digest of the request it sends (key, merged flag and title),
 *   never the request itself. Its safety declarations, retry policy and
 *   provider-cancellation support come from the world's per-PR declaration,
 *   as an author's adapter configuration would.
 * - The template also has `paid`, a member memo making the same operation,
 *   and `isolated`, a member memo whose body calls `paid` as its memoized
 *   child: the author pattern that isolates each paid call in its own step,
 *   so a resumed parent reuses a published child instead of paying again.
 * - `report` is a strict fold over every member's assessment: the succeeded
 *   members' scores, in canonical key order.
 * - `tally` is an outcome (tolerant) fold over the same members: each
 *   member's settled status.
 *
 * Every pull request's title is a planted secret, and the provider's answer
 * carries planted text too. The folds consume only `score` and statuses, so
 * no fold result holds a planted value, and the worker never prints a body
 * value; the privacy case relies on both. The world can also plant author
 * failures whose messages carry the planted titles: in a member body after
 * its answer (`failAfter`), in the discovery source's check and in the
 * report's fold body (`failures`).
 *
 * Every helper call that stands for a body writes one trace line
 * synchronously to fd 1, so the parent counts bodies from author-level
 * evidence. Callbacks capture nothing but their typed context; every effect
 * goes through a declared helper over the process's selected world.
 *
 * @see ../../../../docs/plans/m5-operations.md (Consumer outcome; Planned evidence names)
 * @see ../../../../docs/spec/operations.md (RUN-010 to RUN-014, RUN-017)
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeSync } from 'node:fs';

import { authoring, currentExecution, currentRun, sourceOutcome } from 'microdelta';
import type { IAuthoring, IComposition, IFoldEntry, IMemberBuilder, IOperationRequest, IOutcomeEntry, ISourceOutcome, IStepDescriptor, ITrackedView } from 'microdelta';

import { perform } from './provider.js';
import type { IProviderAnswer, IProviderProcess, IScriptedResponse } from './provider.js';

/** The analysis scope: one repository's paid assessments. */
export const analysisScope = 'm5-acceptance:acme/widget';

/** The composition-level slot holding the discovery collection. */
export const collectionSlot = 'prs';

/** The template slot whose instances are the pull requests. */
export const templateSlot = 'pr';

/** The template's member memo slot: one paid assessment. */
export const stepSlot = 'assess';

/** The composition-level slot of the strict report fold. */
export const reportSlot = 'report';

/** The composition-level slot of the outcome fold. */
export const tallySlot = 'tally';

/** The external operation's identifier name. */
export const operationName = 'assess';

/** The identifier name of the fallback operation a `catchAndFallback` body makes after a failure. */
export const fallbackName = 'assess.fallback';

/** One upstream pull request. Its title is a planted secret: it must never appear in framework output. */
export interface IWorldPullRequest {
  readonly key: string;
  readonly merged: boolean;
  readonly title: string;
}

/**
 * The author's per-PR operation declaration, as an adapter's configuration
 * would state it. Absent fields keep the framework's defaults: no safety
 * basis, one attempt, the default rate-limit retry cap and no provider
 * cancellation.
 */
export interface IOperationDeclaration {
  /** The author declares repeating this operation acceptable. */
  readonly safeToRepeat?: boolean;
  /** The provider deduplicates by idempotency key. */
  readonly providerIdempotency?: boolean;
  /** Request attempts allowed for transient failures and, with a safety basis, unknown outcomes. */
  readonly maxAttempts?: number;
  /** The wait before a transient retry. */
  readonly backoffMilliseconds?: number;
  /** Deferred retries of a rate limit with a retry time before the operation fails as exhausted. */
  readonly rateLimitRetries?: number;
  /** How the provider answers a cancellation request after a hard stop; absent, it supports none. */
  readonly cancel?: 'cancelled' | 'running';
  /** The body catches the operation's failure and calls the same operation again, as a naive author might. */
  readonly catchAndRetry?: boolean;
  /** The body catches the operation's failure and makes a different fallback operation instead, as another naive author might. */
  readonly catchAndFallback?: boolean;
  /** The body fails after its answer with an author error whose message carries the planted title. */
  readonly failAfter?: boolean;
}

/**
 * Author failures the world plants in composition-level bodies, each with an
 * error message that carries a planted title: the discovery source's check,
 * and the strict report's fold body.
 */
export interface IWorldFailures {
  readonly listing?: boolean;
  readonly report?: boolean;
}

/** The external world one process sees, written by the parent before each process starts. */
export interface IWorld {
  readonly pullRequests: readonly IWorldPullRequest[];
  /** Author failures planted in composition-level bodies; none when absent. */
  readonly failures?: IWorldFailures;
  /** Per-PR operation declarations by key. */
  readonly declarations: Readonly<Record<string, IOperationDeclaration>>;
  /** Per-PR provider scripts by key; see `provider.ts`. */
  readonly script: Readonly<Record<string, readonly IScriptedResponse[]>>;
}

/** One discovered pull request, as discovery lists it. */
export interface IPullRequestRecord {
  readonly key: string;
}

/** The discovery result. */
export interface IListing {
  readonly members: readonly IPullRequestRecord[];
  readonly status: 'complete';
}

/** One assessment. The folds consume only `score`; the explanation carries planted provider text. */
export interface IAssessment {
  readonly score: number;
  readonly explanation: string;
}

/** The strict report: each succeeded member's key and score, in canonical key order. */
export interface IReport {
  readonly scores: readonly (readonly [string, number])[];
}

/** The outcome fold's tally: each member's settled status as `<key>=<status>`, in canonical key order. */
export interface ITally {
  readonly statuses: readonly string[];
}

/** The declared input record (the analysis reads no inputs). */
export type IInputs = Record<never, never>;

/** The declared helper record. */
export interface IHelpers {
  readonly listing: () => ISourceOutcome<IListing>;
  readonly assess: (key: string) => Promise<IAssessment>;
  readonly paid: (key: string) => Promise<IAssessment>;
  readonly answered: (key: string) => void;
  readonly render: (entries: readonly IFoldEntry<ITrackedView<IAssessment>>[]) => IReport;
  readonly tally: (entries: readonly IOutcomeEntry<ITrackedView<IAssessment>>[]) => ITally;
}

/** The world file this process reads; selected once by the worker. */
let worldFile: string | undefined;

/** The provider this process sends to; selected once by the worker. */
let provider: IProviderProcess | undefined;

/** Select the world file for the rest of this process. */
export function useWorld(path: string): void {
  worldFile = path;
}

/** Select the provider for the rest of this process. */
export function useProvider(selected: IProviderProcess): void {
  provider = selected;
}

/** Read the current external world. */
export function readWorld(): IWorld {
  if (worldFile === undefined) {
    throw new Error('no world file selected for this process');
  }
  // The harness parent writes the world file in exactly this shape.
  return JSON.parse(readFileSync(worldFile, 'utf8')) as IWorld;
}

/** Write one trace line synchronously; traces carry identifiers only. */
export function trace(entry: Readonly<Record<string, string>>): void {
  writeSync(1, `${JSON.stringify({ t: 'trace', ...entry })}\n`);
}

/**
 * The binding digest of one assessment request: SHA-256 over the request
 * the provider receives. The parent computes the same digest to prove it
 * never appears in framework output.
 */
export function bindingOf(pullRequest: IWorldPullRequest): string {
  return `sha256:${createHash('sha256').update(JSON.stringify({ key: pullRequest.key, merged: pullRequest.merged, title: pullRequest.title })).digest('hex')}`;
}

/** Discovery: the world's pull requests, as a complete listing. */
function listing(): ISourceOutcome<IListing> {
  trace({ helper: 'listing' });
  const world = readWorld();
  if (world.failures?.listing === true) {
    throw new Error(`the listing failed at ${world.pullRequests.map((pullRequest) => pullRequest.title).join(', ')}`);
  }
  return sourceOutcome.fresh<IListing>({ members: readWorld().pullRequests.map((pullRequest) => ({ key: pullRequest.key })), status: 'complete' });
}

/** The provider this process selected. */
function selectedProvider(): IProviderProcess {
  if (provider === undefined) {
    throw new Error('no provider selected for this process');
  }
  return provider;
}

/** The operation request of one PR's assessment, under the world's declaration for it. */
function assessmentRequest(pullRequest: IWorldPullRequest, declaration: IOperationDeclaration, script: readonly IScriptedResponse[]): IOperationRequest<IProviderAnswer> {
  const selected = selectedProvider();
  const cancelAnswer = declaration.cancel;
  return {
    name: operationName,
    binding: bindingOf(pullRequest),
    ...(declaration.safeToRepeat === undefined ? {} : { safeToRepeat: declaration.safeToRepeat }),
    ...(declaration.providerIdempotency === undefined ? {} : { providerIdempotency: declaration.providerIdempotency }),
    retry: {
      ...(declaration.maxAttempts === undefined ? {} : { maxAttempts: declaration.maxAttempts }),
      ...(declaration.backoffMilliseconds === undefined ? {} : { backoffMilliseconds: declaration.backoffMilliseconds }),
      ...(declaration.rateLimitRetries === undefined ? {} : { rateLimitRetries: declaration.rateLimitRetries }),
    },
    perform: (send) => perform(selected, script, pullRequest, send),
    ...(cancelAnswer === undefined ? {} : { cancel: () => Promise.resolve(cancelAnswer) }),
  };
}

/**
 * One member's assessment: one external operation through the live run's
 * execution controls. With `catchAndRetry` the body catches the failure and
 * calls the same operation again, which the taint guard must refuse without
 * sending. With `catchAndFallback` it makes a different fallback operation
 * instead, which the same guard must refuse because the step attempt already
 * holds a pending signal. With `failAfter` the body fails after its answer with an author
 * error carrying planted text, which no framework output may repeat.
 */
async function assessIn(key: string, step: 'assess' | 'paid'): Promise<IAssessment> {
  // The body's run context, read before the operation's awaits and again after them (RUN-001, A-18).
  const before = currentRun();
  trace({ helper: 'assess', key, run: before.runId, environment: before.environment });
  const world = readWorld();
  const pullRequest = world.pullRequests.find((candidate) => candidate.key === key);
  if (pullRequest === undefined) {
    throw new Error(`the world lists no pull request ${key}`);
  }
  const declaration = world.declarations[key] ?? {};
  const request = assessmentRequest(pullRequest, declaration, world.script[key] ?? []);
  let answer: IProviderAnswer;
  try {
    answer = await currentExecution().operation<IProviderAnswer>(request);
  } catch (error: unknown) {
    if (declaration.catchAndRetry !== true && declaration.catchAndFallback !== true) {
      throw error;
    }
    trace({ helper: 'caught', key });
    answer = await currentExecution().operation<IProviderAnswer>(declaration.catchAndFallback === true
      ? { ...request, name: fallbackName, binding: `${request.binding}:fallback` }
      : request);
  }
  const after = currentRun();
  trace({ helper: 'assessed', key, run: after.runId, environment: after.environment });
  if (declaration.failAfter === true) {
    throw new Error(`the author's summary of ${pullRequest.title} failed: ${answer.explanation}`);
  }
  selectedProvider().onAnswered(key, step);
  return { score: answer.score, explanation: answer.explanation };
}

/** The `assess` memo's body: the paid call made in the step itself. */
function assess(key: string): Promise<IAssessment> {
  return assessIn(key, 'assess');
}

/** The `paid` child memo's body: the same paid call, isolated in its own step (EXP-8 resolution 3). */
function paid(key: string): Promise<IAssessment> {
  return assessIn(key, 'paid');
}

/** The `isolated` parent's observation that its child's paid answer came back, before the parent publishes. */
function answered(key: string): void {
  selectedProvider().onAnswered(key, 'isolated');
}

/** The strict report: succeeded members' scores. */
function render(entries: readonly IFoldEntry<ITrackedView<IAssessment>>[]): IReport {
  trace({ helper: 'report' });
  const world = readWorld();
  if (world.failures?.report === true) {
    throw new Error(`the report failed at ${world.pullRequests.map((pullRequest) => pullRequest.title).join(', ')}`);
  }
  return { scores: entries.flatMap((entry): (readonly [string, number])[] => entry.status === 'succeeded' ? [[entry.key, entry.data.score]] : []) };
}

/** The outcome fold's tally: every member's settled status. */
function tally(entries: readonly IOutcomeEntry<ITrackedView<IAssessment>>[]): ITally {
  trace({ helper: 'tally' });
  return { statuses: entries.map((entry) => `${entry.key}=${entry.status}`) };
}

/** One fresh composition and the descriptors a worker resolves. */
export interface IAnalysis {
  readonly authoring: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  /** The strict report fold. */
  readonly report: IStepDescriptor;
  /** The outcome fold. */
  readonly tally: IStepDescriptor;
  /** One member's assessment step. */
  assessment(memberKey: string): IStepDescriptor;
  /** One member's `isolated` step, whose paid call is its `paid` child. */
  isolated(memberKey: string): IStepDescriptor;
}

/** Compose the analysis with fresh allocations, as each process does. */
export function composeAnalysis(): IAnalysis {
  const builders = authoring<IInputs, IHelpers>();
  const { source, template, fold, outcomeFold, compose } = builders;
  const prs = source<IListing>({
    subject: 'prs:acme/widget',
    collection: { identity: 'key' },
    finality: () => true,
    run: ({ helpers }) => helpers.listing(),
  });
  const steps = (member: IMemberBuilder<IInputs, IHelpers, IPullRequestRecord>) => {
    const assessed = member.memo({
      subject: member.subject('assessment'),
      run: ({ member: bound, helpers }) => helpers.assess(bound.key),
    });
    const paidCall = member.memo({
      subject: member.subject('paid'),
      run: ({ member: bound, helpers }) => helpers.paid(bound.key),
    });
    const isolated = member.memo({
      subject: member.subject('isolated'),
      children: { paid: paidCall },
      run: async ({ calls, member: bound, helpers }) => {
        const child = await calls.paid();
        helpers.answered(bound.key);
        return { score: child.data.score, explanation: 'scored by the isolated paid child' };
      },
    });
    return { assess: assessed, paid: paidCall, isolated };
  };
  const pr = template({ slot: templateSlot, collection: prs, steps });
  const report = fold({ subject: 'report:acme/widget', over: { template: pr, step: stepSlot }, run: ({ members, helpers }) => helpers.render(members) });
  const tallied = outcomeFold({ subject: 'tally:acme/widget', over: { template: pr, step: stepSlot }, run: ({ members, helpers }) => helpers.tally(members) });
  const composition = compose({
    scope: analysisScope,
    inputs: [],
    helpers: [
      { slot: 'listing', helper: listing },
      { slot: 'assess', helper: assess },
      { slot: 'paid', helper: paid },
      { slot: 'answered', helper: answered },
      { slot: 'render', helper: render },
      { slot: 'tally', helper: tally },
    ],
    steps: [
      { slot: collectionSlot, declaration: prs },
      { slot: reportSlot, declaration: report },
      { slot: tallySlot, declaration: tallied },
    ],
    templates: [pr],
  });
  return {
    authoring: builders,
    composition,
    report: Object.freeze({ scope: analysisScope, role: 'step', slot: reportSlot }),
    tally: Object.freeze({ scope: analysisScope, role: 'step', slot: tallySlot }),
    assessment: (memberKey) => Object.freeze({ scope: analysisScope, role: 'step', slot: stepSlot, template: templateSlot, collection: collectionSlot, memberKey }),
    isolated: (memberKey) => Object.freeze({ scope: analysisScope, role: 'step', slot: 'isolated', template: templateSlot, collection: collectionSlot, memberKey }),
  };
}
