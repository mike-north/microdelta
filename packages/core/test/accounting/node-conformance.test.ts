/**
 * Node conformance for Resource Accounting's SQLite port: the production
 * adapter over Node's real SQLite capability, as assembly composes it. It
 * covers keyed idempotent acknowledgment, attribution refusals, unknown usage
 * in every summary, separate estimates, environment scoping, independence from
 * History's writer fence, commit-boundary faults and schema ownership.
 * Process-termination evidence is in `crash-recovery.test.ts`.
 *
 * @see ../../../../docs/spec/operations.md (ACC-001–ACC-008, RUN-017)
 * @see ../../../../docs/spec/architecture.md (ARC-001, ARC-003, ARC-009)
 * @see ../../../../experiments/exp-8/decision.md (mechanism 4: intent-before-call and keyed acknowledgment)
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import {
  AccountingDurabilityUnknownError,
  AccountingSchemaError,
  UnattributableUsageError,
  UsageIntentConflictError,
} from '@microdelta/accounting';
import type { IUsageEstimate, IUsageQuery, IUsageSummary } from '@microdelta/accounting';
import { StaleWriterError, openDurableHistory } from '@microdelta/history';
import { createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';

import {
  InjectedFault,
  adaAttribution,
  cleanup,
  faultySqlite,
  freshLocation,
  intentFor,
  logicalStore,
  openAccounting,
  openRaw,
  tokenReport,
} from './support.js';

afterEach(cleanup);

/** An estimate converting observed tokens to assumed currency. */
function pricingEstimate(overrides: Partial<IUsageEstimate> = {}): IUsageEstimate {
  return {
    environment: 'production',
    estimate: 'estimate-1',
    attribution: adaAttribution,
    quantities: [{ unit: 'usd.micros', amount: 300 }],
    basis: { format: 'test.token-pricing', formatVersion: 1, assumptions: { microsPerInputToken: 3, cachedInput: 'assumed-uncached' } },
    ...overrides,
  };
}

/** The observed amount of `unit` in a summary, or `undefined` when no report stated it. */
function observedAmount(summary: IUsageSummary, unit: string): number | undefined {
  return summary.observed.find((quantity) => quantity.unit === unit)?.amount;
}

describe('keyed, idempotent usage acknowledgment (ACC-003, ACC-007)', () => {
  test('a redelivered report is a duplicate and is counted once', () => {
    const accounting = openAccounting({ location: freshLocation() });
    expect(accounting.recordUsageIntent(intentFor('op-1', 'req-1'))).toBe('recorded');
    const report = tokenReport('op-1', 'req-1', 'usage-1', 100);

    expect(accounting.acknowledgeUsage(report)).toEqual({ kind: 'acknowledged', report });
    expect(accounting.acknowledgeUsage(report)).toEqual({ kind: 'duplicate', report });
    expect(accounting.acknowledgeUsage(report).kind).toBe('duplicate');

    const summary = accounting.summarizeUsage({ environment: 'production' });
    expect(summary).toMatchObject({ status: 'complete', reports: 1, requestAttempts: 1, operations: 1, observed: [{ unit: 'tokens.input', amount: 100 }] });
  });

  test('the same report identity on two operations counts twice', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    accounting.recordUsageIntent(intentFor('op-2', 'req-2'));

    expect(accounting.acknowledgeUsage(tokenReport('op-1', 'req-1', 'usage-shared', 100)).kind).toBe('acknowledged');
    expect(accounting.acknowledgeUsage(tokenReport('op-2', 'req-2', 'usage-shared', 100)).kind).toBe('acknowledged');

    expect(accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'complete', reports: 2, observed: [{ unit: 'tokens.input', amount: 200 }] });
    expect(observedAmount(accounting.summarizeUsage({ environment: 'production', operation: 'op-1' }), 'tokens.input')).toBe(100);
    expect(observedAmount(accounting.summarizeUsage({ environment: 'production', operation: 'op-2' }), 'tokens.input')).toBe(100);
  });

  test('distinct reports of one operation each count, including across its retried requests', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    accounting.recordUsageIntent(intentFor('op-1', 'req-2', { attribution: { run: 'run-2', member: 'ada', stepAttempt: 'attempt-2' } }));
    accounting.acknowledgeUsage({ environment: 'production', operation: 'op-1', requestAttempt: 'req-1', report: 'refusal-1', quantities: [{ unit: 'requests', amount: 1 }] });
    accounting.acknowledgeUsage(tokenReport('op-1', 'req-2', 'usage-2', 100));

    expect(accounting.summarizeUsage({ environment: 'production', operation: 'op-1' })).toMatchObject({
      status: 'complete',
      operations: 1,
      requestAttempts: 2,
      reports: 2,
      observed: [{ unit: 'requests', amount: 1 }, { unit: 'tokens.input', amount: 100 }],
    });
    // Roll-ups follow each request's own run: a retry's usage is not the first run's usage (ACC-002).
    expect(accounting.summarizeUsage({ environment: 'production', run: 'run-1' }).observed).toEqual([{ unit: 'requests', amount: 1 }]);
    expect(accounting.summarizeUsage({ environment: 'production', run: 'run-2' }).observed).toEqual([{ unit: 'tokens.input', amount: 100 }]);
  });

  test('a conflicting redelivery keeps the first report and is not counted', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    accounting.recordUsageIntent(intentFor('op-1', 'req-2'));
    const first = tokenReport('op-1', 'req-1', 'usage-1', 100);
    accounting.acknowledgeUsage(first);

    expect(accounting.acknowledgeUsage(tokenReport('op-1', 'req-1', 'usage-1', 150))).toEqual({ kind: 'conflict', report: first });
    expect(accounting.acknowledgeUsage(tokenReport('op-1', 'req-2', 'usage-1', 100))).toEqual({ kind: 'conflict', report: first });
    const summary = accounting.summarizeUsage({ environment: 'production' });
    expect(summary).toMatchObject({ reports: 1, observed: [{ unit: 'tokens.input', amount: 100 }] });
    // The refused delivery named the second attempt, which still has no report of its own.
    expect(summary).toMatchObject({ status: 'incomplete', unknown: [{ operation: 'op-1', requestAttempt: 'req-2' }] });
    expect(summary.unknown).toHaveLength(1);
  });

  test('unknown usage is pinned per request attempt: a reported sibling attempt does not cover another', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    accounting.recordUsageIntent(intentFor('op-1', 'req-2', { attribution: { run: 'run-2', member: 'ada', stepAttempt: 'attempt-2' } }));
    accounting.acknowledgeUsage(tokenReport('op-1', 'req-1', 'usage-1', 100));

    for (const query of [{ environment: 'production' }, { environment: 'production', operation: 'op-1' }]) {
      const summary = accounting.summarizeUsage(query);
      expect(summary).toMatchObject({ status: 'incomplete', operations: 1, requestAttempts: 2, reports: 1, observed: [{ unit: 'tokens.input', amount: 100 }] });
      expect(summary.unknown).toEqual([{ operation: 'op-1', requestAttempt: 'req-2', attribution: { run: 'run-2', member: 'ada', stepAttempt: 'attempt-2' } }]);
    }
    expect(accounting.summarizeUsage({ environment: 'production', run: 'run-1' }).status).toBe('complete');
    expect(accounting.summarizeUsage({ environment: 'production', run: 'run-2' })).toMatchObject({ status: 'incomplete', observed: [] });
  });

  test('an explicit report of no consumption makes a request attempt known without inventing a quantity', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    accounting.acknowledgeUsage({ environment: 'production', operation: 'op-1', requestAttempt: 'req-1', report: 'none', quantities: [] });
    expect(accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'complete', reports: 1, observed: [], unknown: [] });
  });

  test('redelivered quantities in a different order are the same report', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    const quantities = [{ unit: 'tokens.output', amount: 10 }, { unit: 'tokens.input', amount: 100 }];
    accounting.acknowledgeUsage({ environment: 'production', operation: 'op-1', requestAttempt: 'req-1', report: 'usage-1', quantities });
    expect(accounting.acknowledgeUsage({ environment: 'production', operation: 'op-1', requestAttempt: 'req-1', report: 'usage-1', quantities: [...quantities].reverse() }).kind).toBe('duplicate');
  });
});

describe('attribution (ACC-002)', () => {
  test.each([
    ['an operation with no intent', 'unknown-operation', tokenReport('op-missing', 'req-1', 'usage-1', 100)],
    ['a request attempt with no intent', 'unknown-request-attempt', tokenReport('op-1', 'req-missing', 'usage-1', 100)],
    ["another operation's request attempt", 'request-attempt-of-another-operation', tokenReport('op-1', 'req-2', 'usage-1', 100)],
    ['an operation recorded only in another environment', 'unknown-operation', tokenReport('op-1', 'req-1', 'usage-1', 100, 'trial')],
  ])('a report naming %s is refused as %s and nothing is recorded', (_case, reason, report) => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    accounting.recordUsageIntent(intentFor('op-2', 'req-2'));
    const refusal = (): unknown => accounting.acknowledgeUsage(report);
    expect(refusal).toThrow(UnattributableUsageError);
    expect(refusal).toThrow(expect.objectContaining({ reason }));
    for (const environment of ['production', 'trial']) {
      expect(accounting.summarizeUsage({ environment }).reports).toBe(0);
    }
  });
});

describe('unknown usage is never zero (ACC-005)', () => {
  test('a recorded request attempt without a report reads unknown in every summary that includes it', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    accounting.recordUsageIntent(intentFor('op-2', 'req-2', { attribution: { run: 'run-1', member: 'grace', stepAttempt: 'attempt-9' } }));
    accounting.acknowledgeUsage(tokenReport('op-2', 'req-2', 'usage-2', 100));

    const including: readonly IUsageQuery[] = [
      { environment: 'production' },
      { environment: 'production', run: 'run-1' },
      { environment: 'production', member: 'ada' },
      { environment: 'production', stepAttempt: 'attempt-1' },
      { environment: 'production', operation: 'op-1' },
      { environment: 'production', run: 'run-1', member: 'ada', stepAttempt: 'attempt-1', operation: 'op-1' },
    ];
    for (const query of including) {
      const summary = accounting.summarizeUsage(query);
      expect({ query, status: summary.status }).toEqual({ query, status: 'incomplete' });
      expect(summary.unknown).toEqual([{ operation: 'op-1', requestAttempt: 'req-1', attribution: adaAttribution }]);
      expect(summary.observed.every((quantity) => quantity.amount > 0)).toBe(true);
    }
    // The member's own summary has nothing observed and is still not zero: it is unknown.
    const ada = accounting.summarizeUsage({ environment: 'production', member: 'ada' });
    expect(ada).toMatchObject({ status: 'incomplete', observed: [], reports: 0, requestAttempts: 1 });
    // ACC-005 validation: 100 observed units and the known gap, not an exact total.
    expect(accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'incomplete', observed: [{ unit: 'tokens.input', amount: 100 }] });
    // A scope that excludes the gap is complete.
    expect(accounting.summarizeUsage({ environment: 'production', member: 'grace' })).toMatchObject({ status: 'complete', unknown: [] });
  });

  test('a later acknowledgment resolves the gap exactly once', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    expect(accounting.summarizeUsage({ environment: 'production' }).status).toBe('incomplete');
    accounting.acknowledgeUsage(tokenReport('op-1', 'req-1', 'usage-1', 100));
    expect(accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'complete', observed: [{ unit: 'tokens.input', amount: 100 }] });
  });
});

describe('intents (ACC-007 intent before send)', () => {
  test('a redelivered identical intent is a duplicate', () => {
    const accounting = openAccounting({ location: freshLocation() });
    expect(accounting.recordUsageIntent(intentFor('op-1', 'req-1'))).toBe('recorded');
    expect(accounting.recordUsageIntent(intentFor('op-1', 'req-1'))).toBe('duplicate');
    expect(accounting.summarizeUsage({ environment: 'production' }).requestAttempts).toBe(1);
  });

  test('a request identity cannot stand for another operation or attribution', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    expect(() => accounting.recordUsageIntent(intentFor('op-2', 'req-1'))).toThrow(UsageIntentConflictError);
    expect(() => accounting.recordUsageIntent(intentFor('op-1', 'req-1', { attribution: { ...adaAttribution, run: 'run-2' } }))).toThrow(UsageIntentConflictError);
    expect(accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ operations: 1, requestAttempts: 1 });
  });
});

describe('estimates stay separate (ACC-006)', () => {
  test('an estimate keeps its basis and never enters observed totals', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    accounting.acknowledgeUsage(tokenReport('op-1', 'req-1', 'usage-1', 100));
    const estimate = pricingEstimate();

    expect(accounting.recordEstimate(estimate)).toEqual({ kind: 'recorded', estimate });
    const summary = accounting.summarizeUsage({ environment: 'production' });
    expect(summary.observed).toEqual([{ unit: 'tokens.input', amount: 100 }]);
    expect(observedAmount(summary, 'usd.micros')).toBeUndefined();
    expect(summary.estimates).toEqual([estimate]);
    expect(Object.isFrozen(summary.estimates[0]?.basis.assumptions)).toBe(true);
  });

  test('an estimate alone does not make unknown usage known', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    accounting.recordEstimate(pricingEstimate({ quantities: [{ unit: 'tokens.input', amount: 100 }] }));
    const summary = accounting.summarizeUsage({ environment: 'production' });
    expect(summary).toMatchObject({ status: 'incomplete', observed: [] });
    expect(summary.estimates).toHaveLength(1);
  });

  test('estimates are keyed: duplicates are not repeated and conflicts keep the first', () => {
    const accounting = openAccounting({ location: freshLocation() });
    const estimate = pricingEstimate();
    accounting.recordEstimate(estimate);
    expect(accounting.recordEstimate(pricingEstimate())).toEqual({ kind: 'duplicate', estimate });
    const differentBasis = pricingEstimate({ basis: { format: 'test.token-pricing', formatVersion: 1, assumptions: { microsPerInputToken: 4 } } });
    expect(accounting.recordEstimate(differentBasis)).toEqual({ kind: 'conflict', estimate });
    expect(accounting.summarizeUsage({ environment: 'production' }).estimates).toEqual([estimate]);
  });

  test('estimate filters follow attribution; an operation filter excludes estimates', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordEstimate(pricingEstimate());
    expect(accounting.summarizeUsage({ environment: 'production', member: 'ada' }).estimates).toHaveLength(1);
    expect(accounting.summarizeUsage({ environment: 'production', member: 'grace' }).estimates).toHaveLength(0);
    expect(accounting.summarizeUsage({ environment: 'production', operation: 'op-1' }).estimates).toHaveLength(0);
  });
});

describe('environment scoping (RUN-017)', () => {
  test('identical identities in two environments are independent facts', () => {
    const accounting = openAccounting({ location: freshLocation() });
    for (const environment of ['trial', 'production']) {
      expect(accounting.recordUsageIntent(intentFor('op-1', 'req-1', { environment }))).toBe('recorded');
    }
    expect(accounting.acknowledgeUsage(tokenReport('op-1', 'req-1', 'usage-1', 10, 'trial')).kind).toBe('acknowledged');
    accounting.recordEstimate(pricingEstimate({ environment: 'trial' }));

    expect(accounting.summarizeUsage({ environment: 'trial' })).toMatchObject({ status: 'complete', observed: [{ unit: 'tokens.input', amount: 10 }] });
    expect(accounting.summarizeUsage({ environment: 'trial' }).estimates).toHaveLength(1);
    const production = accounting.summarizeUsage({ environment: 'production' });
    expect(production).toMatchObject({ status: 'incomplete', observed: [], reports: 0, estimates: [] });

    expect(accounting.acknowledgeUsage(tokenReport('op-1', 'req-1', 'usage-1', 99, 'production')).kind).toBe('acknowledged');
    expect(accounting.summarizeUsage({ environment: 'production' }).observed).toEqual([{ unit: 'tokens.input', amount: 99 }]);
    expect(accounting.summarizeUsage({ environment: 'trial' }).observed).toEqual([{ unit: 'tokens.input', amount: 10 }]);
    expect(accounting.summarizeUsage({ environment: 'staging' })).toMatchObject({ status: 'complete', operations: 0, observed: [] });
  });
});

describe('write authority (M5 plan: accounting writes need no writer fence)', () => {
  test("a stale History writer's late usage report is still recorded", () => {
    const clock = { now: 1_000, currentEpochMilliseconds(): number { return this.now; } };
    const historyLocation = freshLocation('history.sqlite');
    const accountingLocation = freshLocation();
    const machine = createNodeMachine();
    const openHistory = () => openDurableHistory({ sqlite: createNodeSqlite(), clock, sha256: machine, location: historyLocation, logicalStore });
    const staleHistory = openHistory();
    const successorHistory = openHistory();
    const staleAccounting = openAccounting({ location: accountingLocation });
    const successorAccounting = openAccounting({ location: accountingLocation });
    try {
      const stale = staleHistory.acquireWriter({ holder: 'run-1', leaseMilliseconds: 100 });
      if (stale.kind !== 'acquired') {
        throw new Error('first writer did not acquire');
      }
      staleAccounting.recordUsageIntent(intentFor('op-1', 'req-1'));

      clock.now = 2_000;
      const successor = successorHistory.acquireWriter({ holder: 'run-2', leaseMilliseconds: 100 });
      expect(successor).toMatchObject({ kind: 'acquired', lease: { holder: 'run-2', fence: stale.lease.fence + 1 } });
      // Publication authority still requires the fence: the stale holder cannot renew or write History.
      expect(() => staleHistory.renewWriter(stale.lease, 100)).toThrow(StaleWriterError);

      // The usage happened, so the stale holder's late report is recorded and counted once.
      expect(staleAccounting.acknowledgeUsage(tokenReport('op-1', 'req-1', 'usage-1', 100)).kind).toBe('acknowledged');
      expect(successorAccounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'complete', observed: [{ unit: 'tokens.input', amount: 100 }] });
      expect(successorAccounting.acknowledgeUsage(tokenReport('op-1', 'req-1', 'usage-1', 100)).kind).toBe('duplicate');
    } finally {
      staleHistory.close();
      successorHistory.close();
    }
  });
});

describe('commit boundaries (ACC-007)', () => {
  test('a failed write issues no acknowledgment, and redelivery records the report once', () => {
    const sqlite = faultySqlite();
    const accounting = openAccounting({ location: freshLocation(), sqlite: sqlite.capability });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    const report = tokenReport('op-1', 'req-1', 'usage-1', 100);

    sqlite.arm({ role: 'report', timing: 'statement', action: 'throw' });
    const failed = (): unknown => accounting.acknowledgeUsage(report);
    expect(failed).toThrow(InjectedFault);
    expect(accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'incomplete', reports: 0 });

    expect(accounting.acknowledgeUsage(report).kind).toBe('acknowledged');
    expect(accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'complete', reports: 1, observed: [{ unit: 'tokens.input', amount: 100 }] });
  });

  test('an unconfirmed commit that did not land is unknown durability, and redelivery records it once', () => {
    const sqlite = faultySqlite();
    const accounting = openAccounting({ location: freshLocation(), sqlite: sqlite.capability });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    const report = tokenReport('op-1', 'req-1', 'usage-1', 100);

    sqlite.arm({ role: 'report', timing: 'before-commit', action: 'throw' });
    const unconfirmed = (): unknown => accounting.acknowledgeUsage(report);
    expect(unconfirmed).toThrow(AccountingDurabilityUnknownError);
    expect(accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'incomplete', reports: 0 });

    expect(accounting.acknowledgeUsage(report)).toEqual({ kind: 'acknowledged', report });
    expect(accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'complete', reports: 1, observed: [{ unit: 'tokens.input', amount: 100 }] });
  });

  test('an unconfirmed commit is reported as unknown durability, and redelivery finds the landed report', () => {
    const sqlite = faultySqlite();
    const accounting = openAccounting({ location: freshLocation(), sqlite: sqlite.capability });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    const report = tokenReport('op-1', 'req-1', 'usage-1', 100);

    sqlite.arm({ role: 'report', timing: 'after-commit', action: 'throw' });
    const lost = (): unknown => accounting.acknowledgeUsage(report);
    expect(lost).toThrow(AccountingDurabilityUnknownError);

    expect(accounting.acknowledgeUsage(report)).toEqual({ kind: 'duplicate', report });
    expect(accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'complete', reports: 1, observed: [{ unit: 'tokens.input', amount: 100 }] });
  });

  test('an intent whose commit is unconfirmed is not acknowledged, and redelivery confirms it', () => {
    const sqlite = faultySqlite();
    const accounting = openAccounting({ location: freshLocation(), sqlite: sqlite.capability });
    sqlite.arm({ role: 'intent', timing: 'after-commit', action: 'throw' });
    expect(() => accounting.recordUsageIntent(intentFor('op-1', 'req-1'))).toThrow(AccountingDurabilityUnknownError);
    expect(accounting.recordUsageIntent(intentFor('op-1', 'req-1'))).toBe('duplicate');
  });
});

describe('schema ownership and immutability', () => {
  test('a store reopens with its facts, and a different logical store is refused', () => {
    const location = freshLocation();
    const first = openAccounting({ location });
    first.recordUsageIntent(intentFor('op-1', 'req-1'));
    first.close();

    expect(openAccounting({ location }).summarizeUsage({ environment: 'production' }).unknown).toHaveLength(1);
    expect(() => openAccounting({ location, store: 'store:other' })).toThrow(AccountingSchemaError);
  });

  test('foreign, altered or incomplete storage is refused before any work', () => {
    const foreign = freshLocation();
    const raw = openRaw(foreign);
    raw.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
    expect(() => openAccounting({ location: foreign })).toThrow(AccountingSchemaError);

    const altered = freshLocation();
    openAccounting({ location: altered }).close();
    const tamper = openRaw(altered);
    tamper.exec('DROP TRIGGER accounting_reports_immutable_update');
    expect(() => openAccounting({ location: altered })).toThrow(AccountingSchemaError);

    const history = freshLocation('history.sqlite');
    openDurableHistory({ sqlite: createNodeSqlite(), clock: { currentEpochMilliseconds: () => 0 }, sha256: createNodeMachine(), location: history, logicalStore }).close();
    expect(() => openAccounting({ location: history })).toThrow(AccountingSchemaError);
  });

  test('recorded facts cannot be updated, deleted or replaced in storage', () => {
    const location = freshLocation();
    const accounting = openAccounting({ location });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    accounting.acknowledgeUsage(tokenReport('op-1', 'req-1', 'usage-1', 100));
    accounting.recordEstimate(pricingEstimate());
    const raw = openRaw(location);
    for (const statement of [
      "UPDATE accounting_report_quantities SET amount = 0",
      "DELETE FROM accounting_reports",
      "UPDATE accounting_request_attempts SET operation = 'op-2'",
      "DELETE FROM accounting_request_attempts",
      "UPDATE accounting_estimates SET basis = 'x'",
      "DELETE FROM accounting_estimate_quantities",
      "UPDATE accounting_identity SET logical_store = 'other'",
      // REPLACE deletes the conflicting row without firing delete triggers, so it is refused separately.
      "INSERT OR REPLACE INTO accounting_report_quantities (environment, operation, report, unit, amount) VALUES ('production', 'op-1', 'usage-1', 'tokens.input', 0)",
      "REPLACE INTO accounting_reports (environment, operation, report, request_attempt) VALUES ('production', 'op-1', 'usage-1', 'req-1')",
      "REPLACE INTO accounting_request_attempts (environment, request_attempt, operation, run, member, step_attempt) VALUES ('production', 'req-1', 'op-1', 'run-9', NULL, NULL)",
      "REPLACE INTO accounting_estimates (environment, estimate, run, member, step_attempt, basis_format, basis_version, basis) VALUES ('production', 'estimate-1', 'run-9', NULL, NULL, 'x', 1, 'x')",
      "REPLACE INTO accounting_estimate_quantities (environment, estimate, unit, amount) VALUES ('production', 'estimate-1', 'usd.micros', 0)",
      "REPLACE INTO accounting_identity (singleton, schema_name, schema_version, logical_store) VALUES (1, 'microdelta.accounting.durable', 1, 'other')",
    ]) {
      expect(() => raw.exec(statement)).toThrow(/immutable/u);
    }
    expect(accounting.summarizeUsage({ environment: 'production' }).estimates).toEqual([pricingEstimate()]);
    expect(accounting.summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'complete', observed: [{ unit: 'tokens.input', amount: 100 }] });
  });

  test('a closed store refuses further use', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.close();
    expect(() => accounting.recordUsageIntent(intentFor('op-1', 'req-1'))).toThrow();
    expect(() => accounting.summarizeUsage({ environment: 'production' })).toThrow();
  });

  test('returned facts are frozen', () => {
    const accounting = openAccounting({ location: freshLocation() });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    const acknowledgment = accounting.acknowledgeUsage(tokenReport('op-1', 'req-1', 'usage-1', 100));
    expect(Object.isFrozen(acknowledgment)).toBe(true);
    expect(Object.isFrozen(acknowledgment.report.quantities)).toBe(true);
    const summary = accounting.summarizeUsage({ environment: 'production' });
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.observed)).toBe(true);
  });
});
