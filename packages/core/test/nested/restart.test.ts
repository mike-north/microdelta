/**
 * Separate-process nested validation (TEST-2 component evidence for issue
 * #84). Process A writes a real SQLite History file; process B is a new Node
 * process that recreates every declaration, callback and input with members,
 * steps, helpers and supplies registered in reverse order, and resolves both
 * summaries. Only durable History and the caller's world file survive between
 * them. Assertions compare exact result references and body counts, derived
 * by hand from the fixture data and the owning contracts:
 *
 * - F-04: a changed child input whose consumed score is equal reruns the
 *   child once and keeps the summary's exact reference with zero summary bodies.
 * - F-05: a changed consumed score reruns the summary and changes its reference.
 * - Supplying implementation B instead of A with equal scores behaves like F-04.
 * - An argument derived after an observed untracked read, and an
 *   unreconstructible argument, are honest misses: the summary reruns and its
 *   children reuse.
 * - A missing or ambiguous assessor slot is a distinct miss and a distinct
 *   failure before any body; nothing is published.
 *
 * @see ../../../../docs/spec/artifacts/reuse-cases.json (F-04, F-05)
 * @see ../../../../docs/spec/acceptance.md (TEST-2)
 * @see ../../../../docs/spec/execution.md (REUSE-005, REUSE-006, REUSE-007)
 * @see ../../../../docs/plans/m4-composition.md (planned evidence: nested-equal-output-cutoff, nested-changed-output, supplied-assessor-swap, binding-and-argument-misses)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from '@jest/globals';

import { cleanup, openHistory } from '../durable-history/support.js';
import { assessmentSubject, createWorld, defaultRubric } from './fixture.js';
import type { IMemberKey, IVariation, IWorld } from './fixture.js';
import { assessmentVersioned, environment, logicalStore } from './support.js';
import type { IMemberReport, INestedJob, INestedResult } from './worker.js';

afterEach(cleanup);

/** The worker entry point, emitted beside this module. */
const worker = fileURLToPath(new URL('./worker.js', import.meta.url));

/** Scenario directories created by this suite, removed after it. */
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** One scenario: a store and a world file in a fresh directory. */
interface IScenario {
  /** Run one independent worker process over the store with `world`. */
  run(variation: IVariation, world?: IWorld, command?: INestedJob['command']): INestedResult;
  /** Exact candidate locators of one scoped subject, latest publication first, read through History's real authority. */
  candidates(subject: string): readonly string[];
}

/** Create a scenario. */
function scenario(): IScenario {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-nested-'));
  directories.push(directory);
  const location = join(directory, 'history.sqlite');
  const worldFile = join(directory, 'world.json');
  return {
    run(variation, world = createWorld(), command = 'resolve') {
      writeFileSync(worldFile, `${JSON.stringify(world)}\n`);
      const job: INestedJob = { location, world: worldFile, variation, command };
      const spawned = spawnSync(process.execPath, [worker, JSON.stringify(job)], { encoding: 'utf8', timeout: 60_000 });
      if (spawned.status !== 0) {
        throw new Error(`worker failed (${String(spawned.status)}/${String(spawned.signal)}): ${spawned.stderr}`);
      }
      const line = spawned.stdout.split('\n').find((text) => text.startsWith('{'));
      if (line === undefined) {
        throw new Error(`worker wrote no result: ${spawned.stdout} ${spawned.stderr}`);
      }
      // The worker writes exactly one INestedResult line.
      return JSON.parse(line) as INestedResult;
    },
    candidates(subject) {
      const history = openHistory({ location, store: logicalStore });
      try {
        return history.findCandidates({ analysis: 'contribution-report:acme/widget', environment, subject, version: 1 }).map((candidate) => candidate.reference.locator);
      } finally {
        history.close();
      }
    },
  };
}

/** The exact reference a member report carries. */
function referenceOf(report: IMemberReport): string {
  if (!('reference' in report)) {
    throw new Error(`expected a result, observed ${JSON.stringify(report)}`);
  }
  return report.reference;
}

/** The miss reasons a member report carries. */
function reasonsOf(report: IMemberReport): readonly string[] {
  if (!('misses' in report)) {
    throw new Error(`expected misses, observed ${JSON.stringify(report)}`);
  }
  return report.misses.map((item) => item.reason);
}

/** The latest assessment locator of one PR. */
function latestAssessment(scene: IScenario, number: number): string | undefined {
  return scene.candidates(assessmentVersioned(assessmentSubject(number)).subject)[0];
}

/** Every PR number in the fixture. */
const pullRequests = [101, 102, 103, 201, 202] as const;

/** Process A: cold run in forward registration order. */
function cold(scene: IScenario, variation: IVariation = {}): { readonly summaries: Readonly<Record<IMemberKey, string>>; readonly assessments: ReadonlyMap<number, string | undefined> } {
  const result = scene.run({ ...variation, order: 'forward' });
  expect(result.outcomes['person:ada'].kind).toBe('published');
  expect(result.outcomes['person:ben'].kind).toBe('published');
  // Every body ran exactly once in the cold process.
  expect(result.counts.summaries).toEqual({ 'person:ada': 1, 'person:ben': 1 });
  expect(result.counts.assessments).toEqual({ 101: 1, 102: 1, 103: 1, 201: 1, 202: 1 });
  return {
    summaries: { 'person:ada': referenceOf(result.outcomes['person:ada']), 'person:ben': referenceOf(result.outcomes['person:ben']) },
    assessments: new Map(pullRequests.map((number) => [number, latestAssessment(scene, number)])),
  };
}

describe('nested validation across independent processes', () => {
  test('an unchanged restart in reversed registration order keeps every exact reference with zero bodies', () => {
    const scene = scenario();
    const a = cold(scene);
    const b = scene.run({ order: 'reversed' });
    expect(referenceOf(b.outcomes['person:ada'])).toBe(a.summaries['person:ada']);
    expect(referenceOf(b.outcomes['person:ben'])).toBe(a.summaries['person:ben']);
    expect(b.outcomes['person:ada']).toMatchObject({ kind: 'reused', misses: [] });
    expect(b.counts).toEqual({ checks: { 'person:ada': 0, 'person:ben': 0 }, initials: { 'person:ada': 0, 'person:ben': 0 }, summaries: { 'person:ada': 0, 'person:ben': 0 }, assessments: {} });
  });

  test('F-04 nested-equal-output-cutoff: the child reruns once, the summary keeps its exact reference and runs zero bodies', () => {
    const scene = scenario();
    const a = cold(scene);
    const b = scene.run({ order: 'reversed', rubricInput: { ...defaultRubric, prompt: 'v2' } });
    for (const key of ['person:ada', 'person:ben'] as const) {
      expect(b.outcomes[key]).toMatchObject({ kind: 'reused', misses: [] });
      expect(referenceOf(b.outcomes[key])).toBe(a.summaries[key]);
    }
    expect(b.counts.summaries).toEqual({ 'person:ada': 0, 'person:ben': 0 });
    expect(b.counts.assessments).toEqual({ 101: 1, 102: 1, 103: 1, 201: 1, 202: 1 });
    for (const number of pullRequests) {
      // Each child produced a new exact result; the parent consumed only its equal score.
      expect(latestAssessment(scene, number)).not.toBe(a.assessments.get(number));
    }
  });

  test('F-05 nested-changed-output: a changed consumed score reruns the summary and changes its exact reference', () => {
    const scene = scenario();
    const a = cold(scene);
    const b = scene.run({ order: 'reversed', rubricInput: { ...defaultRubric, mergedWeight: 3 } });
    for (const key of ['person:ada', 'person:ben'] as const) {
      expect(b.outcomes[key].kind).toBe('published');
      expect(reasonsOf(b.outcomes[key])).toEqual(['changed-child-output']);
      expect(referenceOf(b.outcomes[key])).not.toBe(a.summaries[key]);
    }
    expect(b.counts.summaries).toEqual({ 'person:ada': 1, 'person:ben': 1 });
    // Only merged PRs read the merged weight; each reran exactly once although validation reached it first.
    expect(b.counts.assessments).toEqual({ 101: 1, 102: 1, 201: 1 });
    expect(latestAssessment(scene, 103)).toBe(a.assessments.get(103));
    expect(latestAssessment(scene, 202)).toBe(a.assessments.get(202));
  });

  test('supplied-assessor-swap: binding B instead of A with equal scores is a child implementation change with the F-04 cutoff', () => {
    const scene = scenario();
    const a = cold(scene);
    const b = scene.run({ order: 'reversed', rubric: 'B' });
    for (const key of ['person:ada', 'person:ben'] as const) {
      expect(b.outcomes[key]).toMatchObject({ kind: 'reused', misses: [] });
      expect(referenceOf(b.outcomes[key])).toBe(a.summaries[key]);
    }
    expect(b.counts.summaries).toEqual({ 'person:ada': 0, 'person:ben': 0 });
    expect(b.counts.assessments).toEqual({ 101: 1, 102: 1, 103: 1, 201: 1, 202: 1 });
  });

  test.each([
    ['untracked', 'unjustified-argument'],
    ['unreconstructible', 'unreconstructible-argument'],
  ] as const)('binding-and-argument-misses (%s): the summary reruns with a distinct miss while every child reuses', (variant, reason) => {
    const scene = scenario();
    const a = cold(scene, { adaSummary: variant });
    const b = scene.run({ order: 'reversed', adaSummary: variant });
    expect(b.outcomes['person:ada'].kind).toBe('published');
    expect(reasonsOf(b.outcomes['person:ada'])).toEqual([reason]);
    expect(referenceOf(b.outcomes['person:ada'])).not.toBe(a.summaries['person:ada']);
    expect(b.outcomes['person:ben']).toMatchObject({ kind: 'reused', misses: [] });
    expect(referenceOf(b.outcomes['person:ben'])).toBe(a.summaries['person:ben']);
    expect(b.counts.summaries).toEqual({ 'person:ada': 1, 'person:ben': 0 });
    expect(b.counts.assessments).toEqual({});
    for (const number of pullRequests) {
      expect(latestAssessment(scene, number)).toBe(a.assessments.get(number));
    }
  });

  test.each([
    ['none', 'missing-binding', /assessor has no current implementation/u],
    ['twice', 'ambiguous-binding', /assessor has 2 current implementations/u],
  ] as const)('binding-and-argument-misses (slot supplied %s on restart): a distinct miss and a distinct failure before any body', (supplied, reason, diagnostic) => {
    const scene = scenario();
    const a = cold(scene);
    const checked = scene.run({ order: 'reversed', supplied }, createWorld(), 'check');
    for (const key of ['person:ada', 'person:ben'] as const) {
      expect(checked.outcomes[key].kind).toBe('execution-required');
      expect(reasonsOf(checked.outcomes[key])).toEqual([reason]);
    }
    const resolved = scene.run({ order: 'reversed', supplied });
    for (const key of ['person:ada', 'person:ben'] as const) {
      const report = resolved.outcomes[key];
      expect(report).toMatchObject({ kind: 'failed', code: 'unbound-step' });
      expect(report.kind === 'failed' ? report.message : '').toMatch(diagnostic);
    }
    expect(resolved.counts.summaries).toEqual({ 'person:ada': 0, 'person:ben': 0 });
    expect(resolved.counts.assessments).toEqual({});
    // Nothing was published for either summary.
    expect(scene.candidates('summary:acme/widget:2026-Q1:person:ada')).toEqual([a.summaries['person:ada']]);
    expect(scene.candidates('summary:acme/widget:2026-Q1:person:ben')).toEqual([a.summaries['person:ben']]);
  });
});
