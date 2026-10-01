/**
 * Shared helpers of the external-operation suites: starting the members and
 * fold requests, reading a report's members, the provider's received
 * requests, the raw journal content History stores, a failed member's
 * Supervision code, and driving a run's controlled clock to completion.
 */
import { ResolutionError } from '@microdelta/resolution';
import { SupervisionError, operationsCollection } from '@microdelta/supervision';
import type { IFoldReport, IMemberOutcome, IMembersReport, IOperationView, IRun, IRunResult } from '@microdelta/supervision';

import { analysis, world } from './fixture.js';
import type { ILedgerEntry } from './provider.js';
import { freshKey, production, until } from './harness.js';
import type { IFakeTimer, IOperationRunOptions, IOperationSession, IStartedRun } from './harness.js';

/** Resolve every PR's assessment in one run. */
export function members(session: IOperationSession, options: IOperationRunOptions = {}): IStartedRun<IMembersReport> {
  return session.start(options, (run: IRun) => run.resolveMembers({ template: 'pr', step: 'assess' }, freshKey()));
}

/** Resolve the strict fold over every PR's assessment in one run. */
export function fold(session: IOperationSession, options: IOperationRunOptions = {}): IStartedRun<IFoldReport> {
  return session.start(options, (run: IRun) => run.resolveFold(session.fixture.report, freshKey()));
}

/** Inspect the environment's operations in a short run that needs no lease. */
export async function inspect(session: IOperationSession, options: IOperationRunOptions = {}): Promise<readonly IOperationView[]> {
  return (await session.start(options, (run) => run.inspectOperations()).done).value;
}

/** The member outcome of one key in a members or fold report. */
export function memberOf(report: { readonly members: readonly IMemberOutcome[] }, key: string): IMemberOutcome {
  const found = report.members.find((member) => member.key === key);
  if (found === undefined) {
    throw new Error(`no member ${key}`);
  }
  return found;
}

/** The provider's received requests for one member, in order. */
export function received(key: string, name = 'assess'): readonly ILedgerEntry[] {
  return world.provider.ledger().filter((entry) => entry.kind === 'received' && entry.key === key && entry.name === name);
}

/** The provider's applied effects for one member, in order. */
export function applied(key: string, name = 'assess'): readonly ILedgerEntry[] {
  return world.provider.ledger().filter((entry) => entry.kind === 'applied' && entry.key === key && entry.name === name);
}

/** Raw journal operation record contents in one environment, as History stores them. */
export function journalContents(session: IOperationSession, environment = production): readonly unknown[] {
  return session.journal.list({ analysis, environment, collection: operationsCollection }).map((entry) => entry.record.content);
}

/** The Supervision code of a failed member's cause, if it has one. */
export function failureCode(member: IMemberOutcome): string | undefined {
  if (member.status !== 'failed') {
    return undefined;
  }
  const cause: unknown = member.error instanceof ResolutionError ? member.error.cause : undefined;
  return cause instanceof SupervisionError ? cause.code : undefined;
}

/** Advance the controlled clock to each pending wake-up until the run settles. */
export async function driveUntilSettled<T>(timer: IFakeTimer, started: IStartedRun<T>): Promise<IRunResult<T>> {
  let settled = false;
  void started.done.then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  for (let round = 0; round < 50 && !settled; round += 1) {
    await until(() => settled || timer.pending().length > 0, 'the run waits for a time or settles');
    const next = [...timer.pending()].sort((left, right) => left - right)[0];
    if (!settled && next !== undefined) {
      timer.advanceTo(next);
    }
  }
  return started.done;
}
