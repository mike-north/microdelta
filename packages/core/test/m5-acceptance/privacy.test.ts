/**
 * `event-privacy` (RUN-013): planted values never appear in any event,
 * diagnostic, stdout or stderr of independent processes over the assembled
 * facade path, across every outcome the paid-like workload reaches.
 *
 * Every pull request title is planted, the provider's answer bodies and
 * error messages carry another planted value, and each operation's binding
 * digest is derived from the planted title. The workload covers success, a
 * lost response, a permanent refusal, a rate limit, a process killed
 * mid-request and its recovery, a hard-stopped send, a usage acknowledgment
 * that recorded nothing, an observer that throws after a commit, operator
 * settlement and both folds. The worker prints every run event, every diagnostic, the
 * members' typed outcomes (including framework error messages), operator
 * views and usage summaries, exactly as a consumer would see them; it never
 * prints a body value.
 *
 * Expectation, from the owner decision (RUN-013): events carry identifiers,
 * statuses, timings, usage figures and exact references only; diagnostics
 * name fields and keys, not their contents. So no output contains a planted
 * value, a planted title, the provider's answer text or a binding digest.
 *
 * Usage units that are not identifiers are dropped from events by code;
 * that rule is proven in-process by `../operations/privacy.test.ts`.
 *
 * @see ../../../../docs/spec/operations.md (RUN-013)
 */
import { describe, expect, test } from '@jest/globals';

import { bindingOf } from './analysis.js';
import type { IWorld } from './analysis.js';
import type { IProcessRun } from './harness.js';
import type { ICommand } from './worker.js';
import { planted } from './provider.js';
import { baseWorld, freshScenario, operationOf, plantedTitle, removeScenarios } from './support.js';

removeScenarios();

describe('event-privacy (RUN-013)', () => {
  test('no planted value, title, answer text or binding digest reaches any event, diagnostic, stdout or stderr', async () => {
    const world: IWorld = baseWorld({
      pullRequests: [
        ...baseWorld().pullRequests,
        { key: 'pr-4', merged: true, title: `${plantedTitle} rewrite the widget parser` },
        { key: 'pr-5', merged: false, title: `${plantedTitle} benchmark the widget` },
      ],
      script: {
        'pr-2': [{ kind: 'lost' }],
        'pr-3': [{ kind: 'refuse' }, { kind: 'ok' }],
        'pr-4': [{ kind: 'rate-limit', retryMs: 200 }],
        'pr-5': [{ kind: 'stall' }],
      },
    });
    const s = freshScenario(world);
    const runs: IProcessRun[] = [];
    const keep = (run: IProcessRun): IProcessRun => {
      runs.push(run);
      return run;
    };

    // Success, a lost response, a refusal, a sleeping rate limit and a hard-stopped stall.
    const mixed = keep(s.run({ kind: 'tally' }, { window: 5, permits: 2, deferral: 'sleep', stops: [{ on: { received: 'pr-5' }, level: 'hard', afterMs: 600 }] }));
    expect(Object.fromEntries(Object.entries(mixed.result.members).map(([key, member]) => [key, member.status]))).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'pending', 'pr-3': 'failed', 'pr-4': 'pending', 'pr-5': 'cancelled' });
    // A killed process mid-request, then its recovery by the next writer.
    const killed = keep(s.run({ kind: 'members' }, { window: 1, leaseMilliseconds: 1_000, kill: { at: 'after-send', key: 'pr-3' } }));
    expect(killed.signal).toBe('SIGKILL');
    await s.outlastLease();
    // The recovering run also meets an acknowledgment that recorded nothing and an observer that throws after a commit: both become diagnostics.
    const recovered = keep(s.run({ kind: 'tally' }, { window: 1, ackFault: { key: 'pr-4', kind: 'unrecorded' }, throwObserverAt: { phase: 'publish', key: 'pr-4' } }));
    // Operator settlement of every unknown operation, then the folds again.
    for (const key of ['pr-2', 'pr-3', 'pr-5']) {
      if (recovered.result.operations.some((view) => view.member === key && view.status === 'unknown')) {
        keep(s.run({ kind: 'settle', operation: operationOf(recovered, key), action: 'abandon' }));
      }
    }
    keep(s.run({ kind: 'tally' }, { window: 1 }));
    keep(s.run({ kind: 'fold' }, { window: 1 }));
    keep(s.run({ kind: 'inspect' }));

    // The workload reached every outcome it was meant to: events, diagnostics and errors were all printed.
    const operations = runs.flatMap((run) => run.operations);
    for (const expected of ['request-settled:unknown:lost-response@pr-2', 'request-settled:failed:permanent@pr-3', 'retry-scheduled:deferred:rate-limited@pr-4', 'request-settled:unknown:stopped@pr-5', 'recovered:unknown:recovered-after-crash@pr-3', 'abandoned:abandoned:operator@pr-2']) {
      expect(operations).toContain(expected);
    }
    expect(runs.some((run) => run.signal === null && run.result.diagnostics.length > 0)).toBe(true);

    const secrets = [planted, plantedTitle, ...world.pullRequests.map((pullRequest) => bindingOf(pullRequest)), 'scores 2', 'scores 1'];
    for (const run of runs) {
      for (const secret of secrets) {
        expect({ secret, found: run.stdout.includes(secret) || run.stderr.includes(secret) }).toEqual({ secret, found: false });
      }
    }
  });

  // Regression (#147): Reuse Resolution once built its typed failures' messages from the author error's message
  // ("Body of <step> failed: …" for a member body and a fold body, "Source check of <step> failed: …" for a source
  // check), so author text, including any value the author put in its error, reached the typed outcome, the run's
  // failure and every consumer that prints them. RUN-013 requires diagnostics to name fields and keys, not their
  // contents; the author's error stays available as the failure's `cause`. Each site is planted separately.
  test('no framework failure message repeats an author error\'s text, from a member body, a fold body or a source check (#147)', () => {
    /** Run one planted failure; the caller first proves the failure fired, then that nothing planted was printed. */
    const plant = (world: IWorld, command: ICommand): { readonly run: IProcessRun; readonly leaked: boolean } => {
      const run = freshScenario(world).run(command, { window: 1 });
      const output = `${run.stdout}${run.stderr}`;
      return { run, leaked: output.includes(planted) || output.includes(plantedTitle) };
    };
    const memberBody = plant(baseWorld({ declarations: { 'pr-1': { failAfter: true } } }), { kind: 'members' });
    const foldBody = plant(baseWorld({ failures: { report: true } }), { kind: 'fold' });
    const sourceCheck = plant(baseWorld({ failures: { listing: true } }), { kind: 'fold' });
    // Preconditions: each planted failure fired, as the kind of failure it is.
    expect(memberBody.run.result.members['pr-1']).toMatchObject({ status: 'failed', code: 'execution-failure' });
    expect({ status: foldBody.run.status, error: foldBody.run.error }).toMatchObject({ status: 3, error: { name: 'ResolutionError', resolution: 'execution-failure', message: expect.stringMatching(/^Body of strict fold \[.*"report".*\]/u) } });
    expect({ status: sourceCheck.run.status, error: sourceCheck.run.error }).toMatchObject({ status: 3, error: { name: 'ResolutionError', resolution: 'execution-failure', message: expect.stringMatching(/^Source check of \[.*"prs".*\]/u) } });
    expect({ memberBody: memberBody.leaked, foldBody: foldBody.leaked, sourceCheck: sourceCheck.leaked }).toEqual({ memberBody: false, foldBody: false, sourceCheck: false });
  });
});
