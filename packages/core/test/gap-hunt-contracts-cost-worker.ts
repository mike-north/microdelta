/** TEST-5/6 finite assembly probe: selective member work and owner-alpha local views over real SQLite. */
import * as assert from 'node:assert/strict';
import { authoring, openWorkspace } from 'microdelta';
import { createMaterialization } from '@microdelta/materialization';
import { createTracking, createTrackingObserver } from '@microdelta/tracking';
import { createNodeMachine } from '@microdelta/machine-node';
import { observedSqlite, openHistory } from './durable-history/support.js';
interface IMember { readonly id: string; readonly score: number; readonly notes: string }
interface IRoster { readonly members: readonly IMember[]; readonly status: 'complete' }
interface IMetricRow { readonly id: string; readonly fields: Readonly<Record<string, number>>; readonly notes: string }
interface ICorpus { readonly members: readonly IMetricRow[] }
interface IHelpers { readonly roster: () => IRoster; readonly trace: (body: string) => void; readonly cpu: (value: number) => number; readonly corpus: () => ICorpus }
type IInputs = Record<never, never>;
/** Repeated deterministic arithmetic supplies CPU cost without I/O or paid execution. */
function cpu(value: number): number { let sum = 0; for (let i = 0; i < 2000; i += 1) { sum += value; } return sum; }
const [location, mode, variant, requestKey] = process.argv.slice(2);
if (location === undefined || mode === undefined || variant === undefined || requestKey === undefined) { throw new Error('Expected location, mode, variant and request'); }
const builders = authoring<IInputs, IHelpers>();
const members = Array.from({ length: 12 }, (_, index) => ({ id: `person:${index}`, score: index + (variant === 'changed' && [2, 5, 9].includes(index) ? 100 : 0), notes: variant === 'unread' ? 'new unread' : 'original unread' }));
const roster = builders.source<IRoster>({ subject: 'roster', collection: { identity: 'id' }, run: ({ helpers, outcome }) => outcome.fresh(helpers.roster()) });
const template = builders.template({ slot: 'person', collection: roster, steps: member => {
  const leaf = member.memo({ subject: member.subject('leaf'), run: ({ member, helpers }) => { helpers.trace(`leaf:${member.id}`); return { score: member.score }; } });
  const enriched = member.memo({ subject: member.subject('enriched'), children: { leaf }, run: async ({ calls, member, helpers }) => {
    const result = await calls.leaf(); helpers.trace(`enriched:${member.id}`); return { score: helpers.cpu(result.data.score) };
  } });
  return { leaf, enriched };
} });
const aggregate = builders.fold({ subject: 'aggregate', over: { template, step: 'leaf' }, run: ({ members, helpers }) => {
  helpers.trace('aggregate');
  let sum = 0;
  for (const member of members) { if (member.status === 'succeeded') { sum += helpers.cpu(member.data.score); } }
  return { sum };
} });
const corpus = builders.memo({ subject: 'corpus', run: ({ helpers }) => { helpers.trace('corpus'); return helpers.corpus(); } });
const composition = builders.compose({ scope: 'cost-probe', inputs: [], steps: [{ slot: 'aggregate', declaration: aggregate }, { slot: 'roster', declaration: roster }, { slot: 'corpus', declaration: corpus }], templates: [template], helpers: [
  { slot: 'roster', helper: (): IRoster => ({ members, status: 'complete' }) },
  { slot: 'trace', helper: (body: string): void => { process.stderr.write(`BODY:${body}\n`); } },
  { slot: 'cpu', helper: cpu },
  { slot: 'corpus', helper: (): ICorpus => ({ members: Array.from({ length: 16 }, (_, index) => ({ id: `person:${index}`, fields: Object.fromEntries(Array.from({ length: 10 }, (_, field) => [`metric:${field}`, index * 10 + field])), notes: 'unread-payload:'.repeat(256) })) }) },
] });
const workspace = openWorkspace({ location, logicalStore: 'cost-store' });
try {
  if (mode === 'aggregate') {
    const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async run => {
      const report = await run.resolveFold({ scope: 'cost-probe', role: 'step', slot: 'aggregate' }, { requestKey });
      if (report.outcome.status !== 'succeeded') { throw new Error(`Unexpected fold ${report.outcome.status}`); }
      const outcome = report.outcome.outcome;
      return { kind: outcome.kind, reference: outcome.reference.locator, data: run.read<{ readonly sum: number }>(outcome.reference) };
    });
    process.stdout.write(`${JSON.stringify(result.value)}\n`);
  } else if (mode === 'enrichment') {
    const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async run => {
      const report = await run.resolveMembers({ template: 'person', step: 'enriched' }, { requestKey });
      return report.members.map(member => {
        if (member.status !== 'succeeded') { throw new Error(`Unexpected member ${member.status}`); }
        return { key: member.key, kind: member.outcome.kind, reference: member.outcome.reference.locator, data: run.read<{ readonly score: number }>(member.outcome.reference) };
      });
    });
    process.stdout.write(`${JSON.stringify({ outcomes: result.value })}\n`);
  } else {
    const resolved = await workspace.run({ authoring: builders, composition, environment: 'test' }, async run => {
      const result = await run.resolve({ scope: 'cost-probe', role: 'step', slot: 'corpus' }, { requestKey });
      if (result.kind !== 'published' && result.kind !== 'reused') { throw new Error(`Unexpected ${result.kind}`); }
      return { kind: result.kind, reference: result.reference };
    });
    workspace.close();
    const sqlite = observedSqlite();
    const history = openHistory({ location, store: 'cost-store', sqlite: sqlite.capability });
    try {
      const reference = resolved.value.reference;
      const before = JSON.stringify(history.readEnvelope(reference));
      const host = createNodeMachine();
      const observer = createTrackingObserver(host);
      const materialization = createMaterialization({ tracking: observer, reader: history.reader, navigationReader: history.reader });
      const mark = sqlite.mark();
      const narrow = Array.from({ length: 10 }, (_, field) => {
        const view = materialization.materializeView<ICorpus>(reference, { path: ['retained', `consumer:${field}`] });
        return observer.capture(() => {
          let sum = 0;
          // eslint-disable-next-line microdelta/tracked-captures -- The fixture selects one fixed consumer column outside durable memo execution; field is its explicit query parameter, never retained evidence.
          for (let index = 0; index < view.members.length; index += 1) { sum += view.members[index]?.fields[`metric:${field}`] ?? 0; }
          return sum;
        });
      });
      const narrowReads = sqlite.evidence(mark);
      assert.equal(narrowReads.rootPayloadCells, 0);
      assert.equal(narrowReads.scalarCells, 160);
      const local = createTracking(host);
      const minimum = local.cell(8);
      const view = materialization.materializeView<ICorpus>(reference, { path: ['retained', 'filter'] });
      let evaluations = 0;
      const selected = local.derived(() => {
        evaluations += 1;
        const threshold = minimum.get();
        const names: string[] = [];
        let aggregate = 0;
        for (let index = 0; index < view.members.length; index += 1) {
          const row = view.members[index];
          if (row !== undefined && (row.fields['metric:0'] ?? 0) >= threshold * 10) { names.push(row.id); aggregate += cpu(row.fields['metric:0'] ?? 0); }
        }
        return { names, aggregate };
      });
      // eslint-disable-next-line microdelta/tracked-captures -- Owner-alpha local derivation deliberately reads a mutable local cell; it is not a durable memo or reuse-validation callback.
      const first = local.withFrame(() => observer.capture(() => selected.get()));
      const cached = selected.get();
      assert.equal(evaluations, 1);
      assert.equal(cached, first.value.value);
      const at = local.snapshot(first.consumed);
      minimum.set(12);
      assert.equal(local.isValid(first.consumed, at), false);
      // eslint-disable-next-line microdelta/tracked-captures -- Capture verifies retained-view reads reenter observation during local recomputation; this cell's lifetime is only this process.
      const second = observer.capture(() => selected.get());
      assert.equal(evaluations, 2);
      assert.equal(second.observations.length > 0, true);
      const other = createTracking(host);
      const tag = [...first.consumed][0];
      assert.notEqual(tag, undefined);
      if (tag === undefined) { throw new Error('Expected local filter tag'); }
      assert.throws(() => other.consume(tag), /process-local/u);
      assert.throws(() => JSON.stringify(tag), /process-local/u);
      const after = JSON.stringify(history.readEnvelope(reference));
      assert.equal(after, before);
      process.stdout.write(`${JSON.stringify({ kind: resolved.value.kind, reference: reference.locator, narrow: narrow.map(capture => capture.value), narrowReads, beforeNames: first.value.value.names, afterNames: second.value.names, beforeAggregate: first.value.value.aggregate, afterAggregate: second.value.aggregate, evaluations, storedUnchanged: after === before, observations: second.observations.length, localTagCount: first.consumed.size, historyCount: history.findCandidates({ analysis: 'cost-probe', environment: 'test', subject: 'corpus', version: 1 }).length })}\n`);
    } finally { history.close(); }
  }
} finally { workspace.close(); }
