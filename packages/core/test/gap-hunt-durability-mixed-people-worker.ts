/**
 * TEST-4.6: a person source may fail independently of another person's
 * memo operation quota. A whole-person summary requires the source and the
 * answered operation; neither missing evidence nor a deferral is empty data.
 * Each invocation is an independent process over the same real SQLite stores.
 */
import * as assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';

import { authoring, currentExecution, openWorkspace, sourceOutcome } from '../src/index.js';
import type { IFoldEntry, IMemberBuilder, IOutcomeEntry, ISourceOutcome, ITrackedView } from '../src/index.js';
import { fakeProvider } from './operations/provider.js';

/** Person identities are stable keys, independent of source availability. */
interface IPerson { readonly key: string }
/** Closed discovery is independent of each person's complete evidence. */
interface IRoster { readonly members: readonly IPerson[]; readonly status: 'complete' }
/** A complete person source, including the legitimate empty case. */
interface ICorpus { readonly key: string; readonly prs: readonly string[]; readonly complete: true }
/** Only complete source evidence and an answered operation yield this value. */
interface ISummary { readonly key: string; readonly count: number; readonly complete: true }
/** An explicitly tolerant report still identifies failures in its original population. */
interface IPartial { readonly statuses: readonly string[] }
/** Author helpers cross synchronous source and asynchronous memo boundaries explicitly. */
interface IHelpers {
  readonly roster: () => ISourceOutcome<IRoster>;
  readonly corpus: (key: string) => ISourceOutcome<ICorpus>;
  readonly summarize: (value: ITrackedView<ICorpus>) => Promise<ISummary>;
  readonly strict: (entries: readonly IFoldEntry<ITrackedView<ISummary>>[]) => IPartial;
  readonly partial: (entries: readonly IOutcomeEntry<ITrackedView<ISummary>>[]) => IPartial;
}
const directory = process.argv[2];
const phase = process.argv[3];
if (directory === undefined || phase === undefined || !['initial', 'early', 'due', 'repair', 'unchanged'].includes(phase)) {
  throw new Error('expected synthetic directory and named phase');
}
/** Three hours of provider quota is crossed by a later host clock, never a real wait. */
const initialTime = 1_000_000;
const retryAt = initialTime + 3 * 60 * 60 * 1000;
Date.now = () => phase === 'initial' ? initialTime : phase === 'early' ? initialTime + 1 : retryAt + 1;
const ledger = join(directory, 'provider.jsonl');
const provider = fakeProvider(() => Date.now(), ledger);
if (phase === 'initial') { provider.script('assessment', 'ben', ['rate-limit:10800000']); }
const bodies: string[] = [];
const record = (name: string): void => { bodies.push(name); appendFileSync(join(directory, 'bodies.jsonl'), `${JSON.stringify({ phase, name })}\n`); };
const roster = (): ISourceOutcome<IRoster> => sourceOutcome.fresh<IRoster>({ members: [{ key: 'ada' }, { key: 'ben' }, { key: 'cy' }], status: 'complete' });
const corpus = (key: string): ISourceOutcome<ICorpus> => {
  record(`source:${key}`);
  if (key === 'ada' && phase !== 'repair' && phase !== 'unchanged') { throw new Error('synthetic person source unavailable'); }
  return sourceOutcome.fresh<ICorpus>({ key, prs: key === 'cy' ? [] : [`${key}-1`, `${key}-2`], complete: true });
};
const summarize = async (value: ITrackedView<ICorpus>): Promise<ISummary> => {
  record(`summary:${value.key}`);
  await currentExecution().operation({ name: 'assessment', binding: `fixture:${value.key}`, perform: (send) => provider.perform('assessment', value.key, send) });
  return { key: value.key, count: value.prs.length, complete: value.complete };
};
const strict = (entries: readonly IFoldEntry<ITrackedView<ISummary>>[]): IPartial => {
  record('strict');
  return { statuses: entries.map((entry) => `${entry.key}=${entry.status}`) };
};
const partial = (entries: readonly IOutcomeEntry<ITrackedView<ISummary>>[]): IPartial => {
  record('partial');
  return { statuses: entries.map((entry) => `${entry.key}=${entry.status}`) };
};
const builders = authoring<object, IHelpers>();
const people = builders.source<IRoster>({ subject: 'people', collection: { identity: 'key' }, finality: () => true, run: ({ helpers }) => helpers.roster() });
const steps = (member: IMemberBuilder<object, IHelpers, IPerson>) => {
  const source = member.source<ICorpus>({ subject: member.subject('corpus'), finality: () => true, run: ({ member: person, helpers }) => helpers.corpus(person.key) });
  const summary = member.memo({ subject: member.subject('summary'), children: { source }, run: async ({ calls, helpers }) => helpers.summarize((await calls.source()).data) });
  return { source, summary };
};
const person = builders.template({ slot: 'person', collection: people, steps });
const report = builders.fold({ subject: 'strict-report', over: { template: person, step: 'summary' }, run: ({ members, helpers }) => helpers.strict(members) });
const outcomes = builders.outcomeFold({ subject: 'partial-report', over: { template: person, step: 'summary' }, run: ({ members, helpers }) => helpers.partial(members) });
const composition = builders.compose({ scope: 'mixed-people', inputs: [], helpers: [{ slot: 'roster', helper: roster }, { slot: 'corpus', helper: corpus }, { slot: 'summarize', helper: summarize }, { slot: 'strict', helper: strict }, { slot: 'partial', helper: partial }], steps: [{ slot: 'people', declaration: people }, { slot: 'strict', declaration: report }, { slot: 'partial', declaration: outcomes }], templates: [person] });
const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'accounting.sqlite'), logicalStore: 'mixed-people' });
const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'mixed-people', accounting });
try {
  // Initial/early strict requests prove failure and pending remain distinct.
  // Later requests fold settled outcomes, then repair all people for strict success.
  const result = await workspace.run({ authoring: builders, composition, environment: 'same', window: 1, permits: 1, deferral: 'exit' }, async (run) => {
    const folded = phase === 'initial' || phase === 'early'
      ? await run.resolveFold({ scope: 'mixed-people', role: 'step', slot: 'strict' }, { requestKey: phase })
      : await run.resolveOutcomeFold({ scope: 'mixed-people', role: 'step', slot: 'partial' }, { requestKey: phase });
    const cy = folded.members.find((member) => member.key === 'cy');
    assert.ok(cy?.status === 'succeeded');
    assert.deepEqual(run.read(cy.outcome.reference), { key: 'cy', count: 0, complete: true });
    const cyReference = cy.outcome.reference.locator;
    if (phase === 'initial') { writeFileSync(join(directory, 'cy-reference.txt'), cyReference); }
    else { assert.equal(cyReference, readFileSync(join(directory, 'cy-reference.txt'), 'utf8')); assert.ok(!bodies.includes('summary:cy')); }
    const statusMap = Object.fromEntries(folded.members.map((member) => [member.key, member.status]));
    const repairing = phase === 'repair' || phase === 'unchanged';
    assert.deepEqual(statusMap, { ada: repairing ? 'succeeded' : 'failed', ben: phase === 'initial' || phase === 'early' ? 'pending' : 'succeeded', cy: 'succeeded' });
    if (phase === 'initial' || phase === 'early') {
      assert.ok(folded.outcome.status === 'failed');
      assert.ok('failed' in folded.outcome);
      assert.deepEqual(folded.outcome.failed, ['ada']);
      assert.deepEqual(folded.outcome.pending, ['ben']);
      assert.ok(!bodies.includes('summary:ada'));
      assert.ok(!bodies.includes('strict'));
      const pending = folded.members.find((member) => member.key === 'ben');
      assert.ok(pending?.status === 'pending');
      assert.deepEqual(pending.blocked, { kind: 'deferred', operation: provider.ledger().find((entry) => entry.key === 'ben')?.operation, notBefore: retryAt });
      const partialFold = await run.resolveOutcomeFold({ scope: 'mixed-people', role: 'step', slot: 'partial' }, { requestKey: `${phase}-partial` });
      assert.ok(partialFold.outcome.status === 'waiting');
      assert.deepEqual(partialFold.outcome.coverage, { succeeded: ['cy'], skipped: [], failed: ['ada'], cancelled: [], pending: ['ben'], openDiscovery: false, complete: false });
      assert.ok(!bodies.includes('partial'));
      return { statusMap, strict: folded.outcome, partial: partialFold.outcome };
    }
    assert.ok(folded.outcome.status === 'folded');
    assert.equal(folded.outcome.outcome.coverage.complete, true);
    assert.deepEqual(run.read(folded.outcome.outcome.reference), { statuses: [`ada=${repairing ? 'succeeded' : 'failed'}`, 'ben=succeeded', 'cy=succeeded'] });
    if (phase === 'due') { writeFileSync(join(directory, 'partial-reference.txt'), folded.outcome.outcome.reference.locator); assert.deepEqual(folded.outcome.outcome.coverage.failed, ['ada']); assert.equal(folded.outcome.outcome.kind, 'published'); }
    if (phase === 'repair') {
      assert.deepEqual(folded.outcome.outcome.coverage.failed, []);
      assert.notEqual(folded.outcome.outcome.reference.locator, readFileSync(join(directory, 'partial-reference.txt'), 'utf8'));
      assert.equal(folded.outcome.outcome.kind, 'published');
      assert.ok(!bodies.includes('summary:ben'));
      const completed = await run.resolveFold({ scope: 'mixed-people', role: 'step', slot: 'strict' }, { requestKey: 'repaired-strict' });
      assert.equal(completed.outcome.status, 'succeeded');
    }
    if (phase === 'unchanged') { assert.equal(folded.outcome.outcome.kind, 'reused'); assert.deepEqual(bodies, []); }
    return { statusMap, partial: folded.outcome };
  });
  const received = provider.ledger().filter((entry) => entry.kind === 'received');
  if (phase === 'initial' || phase === 'early') {
    assert.deepEqual(received.map((entry) => entry.key), ['ben', 'cy']);
    if (phase === 'early') { assert.ok(!bodies.includes('summary:ben')); }
    assert.equal(result.waitingUntil, retryAt);
  } else {
    const ben = received.filter((entry) => entry.key === 'ben');
    assert.equal(ben.length, 2);
    assert.equal(ben[0]?.operation, ben[1]?.operation);
    assert.notEqual(ben[0]?.requestAttempt, ben[1]?.requestAttempt);
    assert.equal(received.filter((entry) => entry.key === 'cy').length, 1);
  }
  console.log(JSON.stringify({ phase, result, bodies, received }));
} finally { workspace.close(); accounting.close(); }
