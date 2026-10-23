import { expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';

test('explicit selected serialization completes all four bisected members', () => {
  const result = spawnSync(process.execPath, ['scratch/gap-hunt/consumer-dx/dist/pipeline.js'], { encoding: 'utf8', env: { ...process.env, DX_STORE: `scratch/gap-hunt/consumer-dx/jest-${process.pid}.sqlite` } });
  expect(result.status).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report.value.discovery.keys).toEqual(['pr:1', 'pr:2', 'pr:3', 'pr:4']);
  expect(report.value.members.map(member => member.status)).toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded']);
});

// Same observation means a process restart; a new observation refreshes discovery.
test('observation token distinguishes restart from nonfinal refresh', () => {
  const directory = mkdtempSync('scratch/gap-hunt/consumer-dx/cutoff-');
  function run(observation) {
    const result = spawnSync(process.execPath, ['scratch/gap-hunt/consumer-dx/dist/pipeline.js'], { encoding: 'utf8', env: { ...process.env, DX_STORE: `${directory}/history.sqlite`, DX_OBSERVATION: observation } });
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
  }
  const first = run('observation:1');
  const restart = run('observation:1');
  const refresh = run('observation:2');
  expect(restart.value.discovery.reference).toEqual(first.value.discovery.reference);
  expect(refresh.value.discovery.reference).not.toEqual(first.value.discovery.reference);
  expect(refresh.value.members.map(member => member.status)).toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded']);
});

// An open cumulative snapshot admits known members without claiming complete discovery.
test('successive open snapshots allow early assessments and retain old member work', () => {
  const directory = mkdtempSync('scratch/gap-hunt/consumer-dx/pages-');
  function page(limit) {
    const result = spawnSync(process.execPath, ['scratch/gap-hunt/consumer-dx/dist/pipeline.js'], { encoding: 'utf8', env: { ...process.env, DX_STORE: `${directory}/history.sqlite`, DX_OBSERVATION: `page:${limit}`, DX_LIMIT: String(limit) } });
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
  }
  const early = page(2);
  expect(early.value.discovery.completion).toBe('open');
  expect(early.value.members.map(member => member.status)).toEqual(['succeeded', 'succeeded']);
  const closed = page(4);
  expect(closed.value.discovery.completion).toBe('complete');
  expect(closed.value.members.map(member => member.status)).toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded']);
  expect(closed.value.members.slice(0, 2).map(member => member.outcome.reference)).toEqual(early.value.members.map(member => member.outcome.reference));
});
