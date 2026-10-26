/** The qualification worker must budget one real fold request, independently from bounded member admission. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { openDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';
import { openWorkspace } from 'microdelta';
import type { IRunObserver } from 'microdelta';
import { composeReport, evaluateReport } from '../../examples/contribution-report/src/controlled/application.js';
import { baseInputs, fixture } from './fixture.js';
import { qualificationPhaseTimeoutMilliseconds, qualificationWriterLeaseMilliseconds } from './workload-budget.js';
import { runWorkloadPhase } from './workload-worker.js';

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'workload-lease-')); });
afterEach(() => { jest.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }); });

describe('qualification request lease and bounded admission', () => {
  test('the actual worker completes a fold that exceeds the default lease while remaining inside its phase budget', async () => {
    const started = Date.now();
    let current = started;
    let advanced = false;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => current);
    const observers: readonly IRunObserver[] = [{ observe(event) {
      // Advance after durable search publication, inside the same fold request;
      // no in-flight send's conservative retry/backoff is part of this lease proof.
      if (!advanced && event.kind === 'step' && event.event.phase === 'publish' && event.event.step.slot === 'search') { advanced = true; current += 30_001; }
    } }];
    try {
      expect(qualificationWriterLeaseMilliseconds).toBeGreaterThan(qualificationPhaseTimeoutMilliseconds);
      const phase = runWorkloadPhase({ directory, phase: 'cold', requestKey: 'worker-lease-wiring', personCount: 1 }, observers);
      await expect(phase).resolves.toMatchObject({ report: { selectedPeople: 1, successfulPeople: 1, pullRequests: 250 } });
      expect(advanced).toBe(true);
      expect(current - started).toBe(30_001);
      expect(current - started).toBeLessThan(qualificationPhaseTimeoutMilliseconds);
      expect((await phase).observed.observedAssessmentRequests).toBe(250);
    } finally { clock.mockRestore(); }
  }, 15_000);

  test('one fold completes nine required people through a two-member window without a caller continuation loop', async () => {
    const people = Array.from({ length: 9 }, (_, index) => ({ key: `person-${String(index + 1)}`, login: `login-${String(index + 1)}`, id: 101 + index }));
    const inputs = { ...baseInputs, csv: `employee_id,github_login,name,active\n${people.map(person => `${person.key},${person.login},Person ${String(person.id)},true`).join('\n')}\n`, selected: people.map(person => person.key) };
    const fake = fixture({ ids: Object.fromEntries(people.map(person => [person.login, [person.id]])) });
    const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'usage.sqlite'), logicalStore: 'window-usage' });
    const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'window-history', accounting });
    try {
      const result = await evaluateReport(workspace, composeReport(inputs, fake.services), { environment: 'production', requestKey: 'bounded-nine', window: 2, permits: 2 });
      expect(result.value.status).toBe('complete');
      expect(result.value.fold.members.map(person => person.status)).toEqual(Array.from({ length: 9 }, () => 'succeeded'));
      expect(fake.assessments).toHaveLength(9);
      expect(fake.requests).toHaveLength(54);
    } finally { workspace.close(); accounting.close(); }
  });
});
