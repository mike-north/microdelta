/**
 * EXP-4 restart outcomes (TEST-2): process A writes a JSON fixture History and
 * exits; process B recreates declarations with reversed registration order,
 * reversed member order and fresh allocations, then runs one pass. Expected
 * references and body counts are derived by hand from the fixture:
 * A appends `assessor(pr-1)=result-1`, `assessor(pr-2)=result-2`,
 * `summary:c-1=result-3`, `assessor(pr-4)=result-4`, `summary:c-3=result-5`,
 * `report=result-6`; bob (`c-2`, activity 1 < minimum 2) is skipped.
 *
 * @see ../../../docs/spec/acceptance.md (TEST-2, A-05, A-06, A-07, A-08, A-11)
 * @see ../../../docs/spec/artifacts/reuse-cases.json (F-04, F-05)
 * @see ../../../docs/spec/operations.md (RUN-005, RUN-010)
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

/** The emitted driver runs in separate OS processes from this suite and from each other. */
const entry = fileURLToPath(new URL('./process-entry.js', import.meta.url));

/** Exit status, empty stderr and parseable output show each process completed independently. */
function stage(stageName: 'A' | 'B', file: string, scenario: string): unknown {
  const child = spawnSync(process.execPath, [entry, stageName, file, scenario], { encoding: 'utf8' });
  expect(child.stderr).toBe('');
  expect(child.status).toBe(0);
  const output: unknown = JSON.parse(child.stdout);
  return output;
}

/** Each scenario owns a fresh file; no live object can cross from writer to reader. */
async function restart(scenario: string): Promise<{ readonly first: unknown; readonly second: unknown; readonly persisted: unknown }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'microdelta-exp4-'));
  const file = path.join(directory, 'history.json');
  try {
    const first = stage('A', file, scenario);
    const second = stage('B', file, scenario);
    const persisted: unknown = JSON.parse(await readFile(file, 'utf8'));
    return { first, second, persisted };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Baseline exact references published by process A. */
const baseline = { 'summary:c-1': 'result-3', 'summary:c-3': 'result-5', report: 'result-6' };

/** Topology is compared between processes, so it is extracted rather than hard-coded. */
function topologyOf(report: unknown): unknown {
  return typeof report === 'object' && report !== null && 'topology' in report ? report.topology : undefined;
}

describe('A-05 nested cutoff across processes (F-04, F-05)', () => {
  test('unchanged: fresh allocations and reversed orders retain every exact reference; the child source hook is still consulted', async () => {
    const { first, second } = await restart('unchanged');
    expect(first).toMatchObject({
      paid: ['assess:pr-1', 'assess:pr-2', 'assess:pr-4', 'report', 'summary:c-1', 'summary:c-3'],
      references: baseline,
    });
    expect(second).toMatchObject({
      memberOrder: ['c-3', 'c-2', 'c-1'],
      paid: [],
      outcomes: { 'summary:c-1': 'succeeded:hit', 'summary:c-2': 'skipped', 'summary:c-3': 'succeeded:hit' },
      fold: { status: 'succeeded', decision: 'hit', reference: 'result-6' },
      references: baseline,
      newRecords: [],
      hookCalls: { pulls: 1, config: 1, collection: 1 },
      factoryCalls: 1,
    });
    expect(topologyOf(second)).toEqual(topologyOf(first));
  });

  test('F-04 child input change with equal selected output: child 1, parent 0, parent reference retained', async () => {
    const { second } = await restart('child-input-equal');
    expect(second).toMatchObject({
      paid: ['assess:pr-1'],
      outcomes: { 'summary:c-1': 'succeeded:hit', 'summary:c-3': 'succeeded:hit' },
      references: baseline,
      newRecords: ['result-7=assessor(pr-1)'],
    });
  });

  test('F-05 child output change reruns the parent and the fold that consumed it', async () => {
    const { second } = await restart('child-output-changed');
    expect(second).toMatchObject({
      paid: ['assess:pr-2', 'report', 'summary:c-1'],
      outcomes: { 'summary:c-1': 'succeeded:changed-child-output', 'summary:c-3': 'succeeded:hit' },
      fold: { status: 'succeeded', decision: 'changed-evidence', reference: 'result-9' },
      references: { 'summary:c-1': 'result-8', 'summary:c-3': 'result-5', report: 'result-9' },
      newRecords: ['result-7=assessor(pr-2)', 'result-8=summary:c-1', 'result-9=report'],
    });
  });

  test('child code change A->B with equal scores: every child reruns, no parent or fold body, same topology', async () => {
    const { first, second } = await restart('assessor-swap-equal');
    expect(second).toMatchObject({
      paid: ['assess:pr-1', 'assess:pr-2', 'assess:pr-4'],
      outcomes: { 'summary:c-1': 'succeeded:hit', 'summary:c-3': 'succeeded:hit' },
      fold: { status: 'succeeded', decision: 'hit' },
      references: baseline,
      newRecords: ['result-7=assessor(pr-4)', 'result-8=assessor(pr-1)', 'result-9=assessor(pr-2)'],
    });
    expect(topologyOf(second)).toEqual(topologyOf(first));
  });

  test('child code change A->C with a changed score reruns only the affected parent and the fold', async () => {
    const { second } = await restart('assessor-swap-changed');
    expect(second).toMatchObject({
      paid: ['assess:pr-1', 'assess:pr-2', 'assess:pr-4', 'report', 'summary:c-3'],
      outcomes: { 'summary:c-1': 'succeeded:hit', 'summary:c-3': 'succeeded:changed-child-output' },
      references: { 'summary:c-1': 'result-3', 'summary:c-3': 'result-8', report: 'result-11' },
    });
  });
});

describe('A-06 binding and argument failures are honest parent misses', () => {
  test.each([
    ['missing-assessor', 'missing-binding'],
    ['ambiguous-assessor', 'ambiguous-binding'],
  ])('%s: distinct diagnostic, no body runs, prior pointers unchanged', async (scenario, reason) => {
    const { second } = await restart(scenario);
    expect(second).toMatchObject({
      paid: [],
      outcomes: { 'summary:c-1': `failed:${reason}`, 'summary:c-2': 'skipped', 'summary:c-3': `failed:${reason}` },
      fold: { status: 'failed', failed: ['c-1', 'c-3'], pending: [], cancelled: [] },
      references: baseline,
      newRecords: [],
    });
  });

  test.each([
    ['unreconstructible-argument'],
    ['unjustified-argument'],
  ])('%s: parent misses and executes normally while every child reuses', async scenario => {
    const { first, second } = await restart(scenario);
    expect(first).toMatchObject({ references: baseline });
    expect(second).toMatchObject({
      paid: ['summary:c-1', 'summary:c-3'],
      outcomes: { 'summary:c-1': `succeeded:${scenario}`, 'summary:c-3': `succeeded:${scenario}` },
      fold: { status: 'succeeded', decision: 'hit', reference: 'result-6' },
      references: { 'summary:c-1': 'result-8', 'summary:c-3': 'result-7', report: 'result-6' },
      newRecords: ['result-7=summary:c-3', 'result-8=summary:c-1'],
    });
  });
});

describe('A-07 keyed collections across processes', () => {
  test('insertion executes only the new member and the fold', async () => {
    const { second } = await restart('inserted-member');
    expect(second).toMatchObject({
      paid: ['assess:pr-6', 'report', 'summary:c-4'],
      outcomes: { 'summary:c-4': 'succeeded:no-history', 'summary:c-1': 'succeeded:hit', 'summary:c-3': 'succeeded:hit' },
      references: { ...baseline, 'summary:c-4': 'result-8', report: 'result-9' },
    });
  });

  test('deletion executes only the fold; the deleted member pointer is not rewritten', async () => {
    const { second } = await restart('deleted-member');
    expect(second).toMatchObject({
      paid: ['report'],
      memberOrder: ['c-2', 'c-1'],
      references: { ...baseline, report: 'result-7' },
    });
  });

  test('unread member and configuration fields change nothing', async () => {
    const { second } = await restart('unread-field');
    expect(second).toMatchObject({ paid: [], references: baseline });
  });

  test('a consumed member field reruns that member only; the fold ignores facts it did not consume', async () => {
    const { second } = await restart('consumed-field');
    expect(second).toMatchObject({
      paid: ['summary:c-1'],
      outcomes: { 'summary:c-1': 'succeeded:changed-evidence', 'summary:c-3': 'succeeded:hit' },
      fold: { status: 'succeeded', decision: 'hit' },
      references: { ...baseline, 'summary:c-1': 'result-7' },
    });
  });

  test('duplicate keys fail before any member work with a diagnostic', async () => {
    const { second } = await restart('duplicate-keys');
    expect(second).toMatchObject({
      paid: [],
      gates: 0,
      collection: { status: 'rejected', diagnostic: expect.stringMatching(/discovery.*c-1.*custom key/su) },
      fold: { status: 'failed' },
      references: baseline,
    });
  });

  test('a custom key keeps member identity when designated ids are renumbered', async () => {
    const { first, second } = await restart('custom-key-renumbered');
    expect(first).toMatchObject({ references: { 'summary:alice': 'result-3', 'summary:carol': 'result-5', report: 'result-6' } });
    expect(second).toMatchObject({
      memberOrder: ['carol', 'bob', 'alice'],
      paid: [],
      references: { 'summary:alice': 'result-3', 'summary:carol': 'result-5', report: 'result-6' },
    });
  });

  test('with the default key, renumbered ids are new members: parents run, keyed children still reuse', async () => {
    const { second } = await restart('default-key-renumbered');
    expect(second).toMatchObject({
      paid: ['report', 'summary:c-11', 'summary:c-13'],
      outcomes: { 'summary:c-11': 'succeeded:no-history', 'summary:c-12': 'skipped', 'summary:c-13': 'succeeded:no-history' },
    });
  });
});

describe('A-08 fixed topology and tracked gates across processes', () => {
  test('a gate flipping true instantiates the member without changing topology', async () => {
    const { first, second } = await restart('gate-flip-on');
    expect(second).toMatchObject({
      paid: ['assess:pr-3', 'report', 'summary:c-2'],
      outcomes: { 'summary:c-2': 'succeeded:no-history' },
      fold: { status: 'succeeded', decision: 'changed-evidence', reference: 'result-9' },
      factoryCalls: 1,
    });
    expect(topologyOf(second)).toEqual(topologyOf(first));
  });

  test('a gate flipping false yields an explicit skip and reruns only the fold', async () => {
    const { second } = await restart('gate-flip-off');
    expect(second).toMatchObject({
      paid: ['report'],
      outcomes: { 'summary:c-3': 'skipped' },
      fold: { status: 'succeeded', value: { total: 4, included: ['c-1'], skipped: ['c-2', 'c-3'] } },
      // Observed harness behavior, escalated in decision.md: a skip does not retract carol's earlier pointer.
      references: { ...baseline, report: 'result-7' },
    });
  });

  test('changed gate evidence without a flip reruns nothing', async () => {
    const { second } = await restart('gate-threshold-no-flip');
    expect(second).toMatchObject({ paid: [], references: baseline });
  });

  test('post-freeze builder mutation in process B is rejected and has no effect', async () => {
    const { first, second } = await restart('builder-mutation');
    expect(second).toMatchObject({ paid: [], references: baseline, lateMutation: expect.stringMatching(/frozen/u) });
    expect(topologyOf(second)).toEqual(topologyOf(first));
  });
});

describe('Criterion 6: changed graph correspondence is a miss, never a remap', () => {
  test('a renamed template slot executes fresh instances; the fold misses on its consumed slot', async () => {
    const { second } = await restart('slot-renamed');
    expect(second).toMatchObject({
      paid: ['report', 'summary:c-1', 'summary:c-3'],
      outcomes: { 'profile:c-1': 'succeeded:no-history', 'profile:c-3': 'succeeded:no-history' },
      fold: { status: 'succeeded', decision: 'missing-binding', reference: 'result-9' },
      references: { ...baseline, 'profile:c-3': 'result-7', 'profile:c-1': 'result-8', report: 'result-9' },
    });
  });

  test('members moved to a different collection binding are new instances; the fold misses', async () => {
    const { second } = await restart('collection-moved');
    expect(second).toMatchObject({
      paid: ['report', 'summary:c-1', 'summary:c-3'],
      outcomes: { 'summary:c-1': 'succeeded:no-history', 'summary:c-3': 'succeeded:no-history' },
      fold: { status: 'succeeded', decision: 'missing-binding' },
    });
  });
});

describe('A-11 readiness and strict-fold policy across processes (RUN-005, RUN-010)', () => {
  test('failed, pending, cancelled and successful members with open discovery; then repaired and closed', async () => {
    const { first, second } = await restart('readiness-repaired');
    expect(first).toMatchObject({
      paid: ['assess:pr-1', 'assess:pr-2', 'assess:pr-6', 'summary:c-1', 'summary:c-4'],
      outcomes: {
        'summary:c-1': 'succeeded:no-history', 'summary:c-2': 'skipped', 'summary:c-3': 'pending',
        'summary:c-4': 'failed:no-history', 'summary:c-5': 'cancelled',
      },
      fold: { status: 'failed', failed: ['c-4'], cancelled: ['c-5'], pending: ['c-3'], openDiscovery: true },
      references: { 'summary:c-1': 'result-3' },
    });
    expect(second).toMatchObject({
      paid: ['assess:pr-4', 'assess:pr-5', 'assess:pr-6', 'report', 'summary:c-3', 'summary:c-4', 'summary:c-5'],
      outcomes: { 'summary:c-1': 'succeeded:hit' },
      fold: { status: 'succeeded', reference: 'result-10', value: { total: 7, included: ['c-1', 'c-3', 'c-4', 'c-5'], skipped: ['c-2'] } },
    });
  });

  test('repaired members publish while discovery stays open and a member is pending; the fold waits', async () => {
    const { second } = await restart('readiness-still-open');
    expect(second).toMatchObject({
      paid: ['assess:pr-5', 'assess:pr-6', 'summary:c-4', 'summary:c-5'],
      fold: { status: 'waiting', openDiscovery: true, pending: ['c-3'] },
      references: { 'summary:c-1': 'result-3', 'summary:c-4': 'result-7', 'summary:c-5': 'result-5' },
    });
  });

  test('RUN-010: a repaired failed member reruns with the fold; unaffected members stay at zero', async () => {
    const { first, second } = await restart('failed-repair');
    expect(first).toMatchObject({ fold: { status: 'failed', failed: ['c-4'] } });
    expect(second).toMatchObject({
      paid: ['assess:pr-6', 'report', 'summary:c-4'],
      outcomes: { 'summary:c-1': 'succeeded:hit', 'summary:c-3': 'succeeded:hit', 'summary:c-4': 'succeeded:no-history' },
      fold: { status: 'succeeded', reference: 'result-8' },
    });
  });

  test('RUN-005: open discovery publishes ready members with the fold unstarted; closing runs only the fold', async () => {
    const { first, second } = await restart('open-discovery');
    expect(first).toMatchObject({
      paid: ['assess:pr-1', 'assess:pr-2', 'assess:pr-4', 'summary:c-1', 'summary:c-3'],
      fold: { status: 'waiting', openDiscovery: true, pending: [] },
      references: { 'summary:c-1': 'result-3', 'summary:c-3': 'result-5' },
    });
    expect(first).not.toMatchObject({ references: { report: expect.anything() } });
    expect(second).toMatchObject({ paid: ['report'], fold: { status: 'succeeded', reference: 'result-6' } });
  });

  test('a closed empty population is a successful fold and is retained; an open empty one waits without rewinding', async () => {
    const empty = await restart('empty-population');
    expect(empty.first).toMatchObject({ fold: { status: 'succeeded', value: { total: 0, included: [], skipped: [] } }, references: { report: 'result-1' } });
    expect(empty.second).toMatchObject({ paid: [], fold: { status: 'succeeded', decision: 'hit', reference: 'result-1' } });
    const open = await restart('empty-open');
    expect(open.second).toMatchObject({ paid: [], fold: { status: 'waiting', openDiscovery: true }, references: { report: 'result-1' } });
  });
});

describe('Criterion 7 and durable shape', () => {
  test('the persisted fixture holds recipes and facts, never functions, closures or live tokens', async () => {
    const { persisted } = await restart('unreconstructible-argument');
    const encoded = JSON.stringify(persisted);
    expect(encoded).toContain('"form":"derived"');
    expect(encoded).toContain('"form":"forwarded"');
    expect(encoded).toContain('"form":"unreconstructible","reason":"function"');
    expect(encoded).not.toMatch(/"(closure|__tag|revision)"/u);
    // Implementation text is evidence and may mention the callback; no argument recipe may carry it.
    const records = typeof persisted === 'object' && persisted !== null && 'records' in persisted && Array.isArray(persisted.records)
      ? persisted.records
      : [];
    const calls: unknown[] = records.map((record: unknown) => typeof record === 'object' && record !== null && 'calls' in record ? record.calls : null);
    expect(JSON.stringify(calls)).not.toMatch(/toUpperCase/u);
  });
});
