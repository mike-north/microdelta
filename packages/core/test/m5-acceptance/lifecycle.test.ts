/**
 * `lifecycle-isolation` (A-18, RUN-001, RUN-017): run-scoped lifecycle in an
 * independent process over the built facade, with durable effects checked
 * from the parent afterwards.
 *
 * One worker process runs two workspaces at once: `alpha` over the
 * scenario's store in `env:alpha`, assessing pr-1 (held at a provider gate),
 * and `beta` over a second store in `env:beta`, assessing pr-2 (which
 * stalls). Once both requests reached the provider, beta's own stop
 * controller requests a hard stop; then the parent opens alpha's gate.
 * Inside alpha a nested frame throws, and a continuation registered inside
 * alpha runs only after alpha closed.
 *
 * Expectations, written by hand from RUN-001 and the A-18 row:
 *
 * - Concurrent runs keep their own context across awaits: every body sees
 *   its own run and environment before and after the operation's awaits, and
 *   every event names the run it belongs to.
 * - Stopping one run never reaches the other: beta is aborted with its remote
 *   state recorded, alpha publishes.
 * - A thrown nested frame restores its parent's context and attribution:
 *   afterwards the run is alpha's, in `env:alpha`, outside any step.
 * - After closure, an escaped callback's use of the run fails clearly with
 *   `run-closed` and sends nothing: context lookup, execution controls, a new
 *   request and an exact read.
 * - No cross-run leakage in durable state: each store holds only its own
 *   environment's results and usage.
 *
 * @see ../../../../docs/spec/operations.md (RUN-001, RUN-017)
 * @see ../../../../docs/spec/acceptance.md (A-18)
 */
import { join } from 'node:path';

import { describe, expect, test } from '@jest/globals';

import { assessmentSubject, baseWorld, freshScenario, removeScenarios, usageOf } from './support.js';

removeScenarios();

describe('lifecycle-isolation (A-18, RUN-001)', () => {
  test('concurrent scopes, a thrown nested frame and a late detached callback: no cross-run leakage, and late use fails clearly', async () => {
    const s = freshScenario(baseWorld({ script: { 'pr-1': [{ kind: 'gate', gate: 'alpha' }], 'pr-2': [{ kind: 'stall' }] } }));
    const second = { location: join(s.directory, 'beta.sqlite'), accounting: join(s.directory, 'beta-accounting.sqlite') };
    const started = s.start({ kind: 'lifecycle', second });
    await started.waitForLine((line) => line['t'] === 'beta-closed', 'the beta run closed after its hard stop');
    // Beta's stop did not reach alpha: alpha is still waiting for its answer.
    expect(started.exitedYet).toBe(false);
    s.open('alpha');
    const run = await started.exited;
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: '' });
    const lifecycle = run.result.lifecycle;
    if (lifecycle === null) {
      throw new Error('the lifecycle command reported nothing');
    }
    const { alpha, beta } = lifecycle;
    expect(alpha).toEqual({ runId: expect.any(String), stop: 'none', interruptions: 0, outcome: 'published' });
    expect(beta).toEqual({ runId: expect.any(String), stop: 'hard', interruptions: 1, outcome: 'refused:cancelled' });
    expect(alpha.runId).not.toBe(beta.runId);

    // Each body saw its own run and environment before and after its awaits.
    const contexts = run.lines.filter((line) => line['t'] === 'trace' && (line['helper'] === 'assess' || line['helper'] === 'assessed')).map((line) => [line['helper'], line['key'], line['run'], line['environment']]);
    expect(contexts).toEqual(expect.arrayContaining([
      ['assess', 'pr-1', alpha.runId, 'env:alpha'],
      ['assess', 'pr-2', beta.runId, 'env:beta'],
      ['assessed', 'pr-1', alpha.runId, 'env:alpha'],
    ]));
    expect(contexts).toHaveLength(3);
    // Every event names the run it belongs to, and member events never cross runs.
    for (const event of run.events) {
      expect([alpha.runId, beta.runId]).toContain(event['runId']);
      if (event['kind'] === 'operation') {
        expect(event['runId']).toBe(event['member'] === 'pr-1' ? alpha.runId : beta.runId);
      }
    }

    // A thrown nested frame restored alpha's own context and attribution.
    expect(lifecycle.afterThrow).toEqual({ runId: alpha.runId, environment: 'env:alpha', step: null, error: 'a nested frame failed' });
    // Late use from a callback that escaped the closed alpha run fails clearly and sends nothing.
    expect(lifecycle.late).toEqual({ currentRun: 'run-closed', currentExecution: 'run-closed', resolve: 'run-closed', read: 'run-closed' });
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2']);
    expect(s.keys('aborted')).toEqual(['pr-2']);

    // No cross-run leakage in durable state: each store holds only its own environment's results and usage.
    expect(s.publications(assessmentSubject('pr-1'), 'env:alpha')).toHaveLength(1);
    expect(s.publications(assessmentSubject('pr-1'), 'env:beta')).toEqual([]);
    expect(s.publications(assessmentSubject('pr-2'), 'env:beta', second.location)).toEqual([]);
    expect(s.publications(assessmentSubject('pr-1'), 'env:alpha', second.location)).toEqual([]);
    expect(usageOf(s.usage('env:alpha'))).toEqual({ status: 'complete', observed: [{ unit: 'tokens', amount: 100 }], unknown: 0, operations: 1, reports: 1, requestAttempts: 1 });
    expect(usageOf(s.usage('env:beta', second.accounting))).toEqual({ status: 'incomplete', observed: [], unknown: 1, operations: 1, reports: 0, requestAttempts: 1 });
    expect(usageOf(s.usage('env:beta'))).toEqual({ status: 'complete', observed: [], unknown: 0, operations: 0, reports: 0, requestAttempts: 0 });
  });
});
