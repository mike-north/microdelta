/** A successful harness command reports the selected mechanism honestly, including rejection and unexecuted matrix cells. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@jest/globals';

import { classifyCandidate, validateQualificationReport } from '../src/evidence.js';
import { qualificationBounds } from '../src/protocol.js';
import type { IQualificationReport } from '../src/protocol.js';
import { runQualification } from './coordinator.js';
import { reply } from './transport.js';

test('the finite actual qualification preserves measured rejection/uncertainty and never infers unexecuted healthy support', async () => {
  const report: IQualificationReport = await runQualification(qualificationBounds);
  process.stdout.write(`${JSON.stringify({ candidateVerdict: report.verdict, harness: report.harness, artifacts: report.artifactDirectory })}\n`);
  expect(report.verdict).toBe(classifyCandidate(report.cases));
  expect(validateQualificationReport(report)).toEqual({ kind: 'valid' });
  if (report.harness === 'infrastructure-inconclusive') {
    expect(report.verdict).toBe('INCONCLUSIVE');
    expect(report.preparation.attempted).toBe(true);
    expect(report.preparation.failure.origin).toBe('infrastructure');
    expect(report.preparation.records.length).toBeGreaterThan(0);
    expect(report.rejectionWitness).toBeUndefined();
    expect(report.limitations.length).toBeGreaterThan(0);
    return;
  }
  if (report.artifactDirectory === undefined) { throw new Error('Actual qualification has no retained artifact directory'); }
  const closed = report.cases[0];
  expect(closed).toMatchObject({ id: 'closed-wal-no-sidecars', fixtureHealth: 'verified-healthy' });
  expect(closed?.execution).not.toBe('unexecuted');
  expect(closed?.observations?.ownerAcknowledgments).toEqual([
    { revision: 1, currentRevision: 1, value: 'A' }, { revision: 2, currentRevision: 2, value: 'B' },
  ]);
  expect(closed?.observations?.ownerExit).toEqual({ code: 0, signal: null });
  expect(closed?.observations?.header).toEqual({ readVersion: 2, writeVersion: 2 });
  expect(closed?.observations?.sourceImages.find(stage => stage.stage === 'before-open')?.image.files.map(file => file.name)).toEqual(['store.sqlite']);
  expect(closed?.observations?.childRecords.some(record => record.role === 'writer')).toBe(true);
  expect(closed?.observations?.childRecords.some(record => record.role === 'reader')).toBe(true);
  for (const stage of closed?.observations?.sourceImages ?? []) {
    for (const file of stage.image.files) {
      const bytes = readFileSync(join(report.artifactDirectory, 'closed-wal-no-sidecars/proof/images', stage.stage, `${file.name}.bytes`));
      expect(bytes.byteLength).toBe(file.bytes); expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
  }
  if (closed?.execution === 'observed') {
    const messages = closed.observations?.childRecords.filter(record => record.role === 'reader').map(record => {
      const decoded: unknown = JSON.parse(record.line); return reply(decoded);
    }) ?? [];
    const opened = messages.find(message => message.kind === 'opened');
    expect(opened?.runtime).toBeNull();
    expect(messages.findIndex(message => message.kind === 'anchored')).toBeLessThan(messages.findIndex(message => message.kind === 'runtime'));
    expect(closed.observations?.runtime).toEqual(report.runtime);
  }
  if (report.verdict === 'REJECT') { expect(report.rejectionWitness).toBeDefined(); }
  expect(['PASS', 'REJECT', 'INCONCLUSIVE']).toContain(report.verdict);
  expect(report.cases.map(cell => cell.id)).toEqual([
    'closed-wal-no-sidecars', 'active-wal', 'active-readonly-sidecars', 'retained-wal-missing-shm',
    'retained-wal-inaccessible-shm', 'missing', 'empty', 'foreign-sqlite', 'corrupt', 'hot-journal',
  ]);
  expect(report.runtime.node).toMatch(/^v(?:2[4-9]|[3-9]\d)\./u);
  expect(report.runtime.driver).toBe('12.9.0'); expect(report.runtime.sqlite).toMatch(/^3\.\d+\.\d+$/u);
  expect(report.runtime.compileOptions.length).toBeGreaterThan(0);
  expect(report.controls.map(control => control.name)).toEqual(['stale-snapshot', 'mixed-revisions', 'immediate', 'content-and-sidecar', 'transient-restoration']);
  for (const name of ['stale-snapshot', 'mixed-revisions', 'immediate', 'content-and-sidecar']) {
    expect(report.controls.find(control => control.name === name)).toMatchObject({ execution: 'observed', oracleRejected: true });
  }
  expect(report.controls.find(control => control.name === 'transient-restoration')).toMatchObject({ execution: 'observed', oracleRejected: false, limitation: expect.any(String) });
  if (report.verdict === 'PASS') {
    for (const id of ['closed-wal-no-sidecars', 'active-wal']) {
      expect(report.cases.find(cell => cell.id === id)).toMatchObject({ fixtureHealth: 'verified-healthy', execution: 'observed',
        committed: 'satisfied', coherence: 'satisfied', domainMutation: 'none', attribution: 'reader-only', sourceEffects: [], transientAbsence: 'qualified' });
    }
    expect(report.controls.every(control => control.execution === 'observed')).toBe(true);
  } else {
    expect(report.limitations.length).toBeGreaterThan(0);
  }
  // This selected collector has sampled stages only; no operation-wide native mutation observer is implemented.
  expect(report.cases.filter(cell => cell.execution !== 'unexecuted').every(cell => cell.transientAbsence === 'unproved')).toBe(true);
  expect(report.verdict).not.toBe('PASS');
}, 210_000);
