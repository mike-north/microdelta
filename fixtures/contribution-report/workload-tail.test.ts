/** Every cohort tail must remain cutoff-valid and quiet through the actual REST adapter. */
import { describe, expect, test } from '@jest/globals';
import type { IOperationSend } from 'microdelta';
import { loadDiscussion, loadPull } from '../../examples/contribution-report/src/controlled/evidence.js';
import { quietFinal } from '../../examples/contribution-report/src/controlled/model.js';
import { createWorkloadHarness } from './workload-harness.js';
import { workloadInputs, workloadPerson, workloadPull } from './workload-fixture.js';

const send: IOperationSend = { signal: { aborted: false, onAbort: () => () => undefined }, operation: 'tail-test-operation', requestAttempt: 'tail-test-attempt', idempotencyKey: undefined };
const tailIndexes = [149, 249, 289, 299] as const;

describe('controlled workload temporal tails', () => {
  test.each(tailIndexes)('last PR in cohort ending at author %i completes actual detail, discussion and quiet policy', async (index) => {
    const person = workloadPerson(index);
    const pull = workloadPull(person, person.pullRequests - 1);
    const harness = createWorkloadHarness(`tail-test-${String(index)}`);
    const transport = (url: string, accept?: 'application/vnd.github.diff') => harness.services.github(url, accept, send);
    const id = `acme/widget#${String(pull.number)}`;
    const detail = await loadPull(id, workloadInputs.scope, transport);
    const discussion = await loadDiscussion(id, workloadInputs.scope, transport, workloadInputs.contentBasis);
    expect(detail.complete).toBe(true);
    expect(discussion.complete).toBe(true);
    expect(quietFinal({ terminalAt: detail.terminalAt, latestActivity: Math.max(detail.latestActivity, discussion.latestActivity), complete: detail.complete && discussion.complete }, workloadInputs.scope.cutoff, workloadInputs.settling.quietSeconds)).toBe(true);
  });
});
