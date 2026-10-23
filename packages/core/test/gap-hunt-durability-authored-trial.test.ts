/**
 * RUN-016 authored trial policy through the same roster/member/summary/fold
 * pipeline. Role counts instantiate the specification's validation example;
 * they are not framework selectors or a prescribed organization taxonomy.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@jest/globals';
import { openDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';

import { authoring, currentExecution, openWorkspace, sourceOutcome } from '../src/index.js';
import type { IFoldEntry, IMemberBuilder, ISourceOutcome, ITrackedView } from '../src/index.js';

interface IPerson { readonly key: string; readonly role: 'staff' | 'designer' | 'pm'; readonly prs: readonly string[] }
interface IRoster { readonly members: readonly IPerson[]; readonly status: 'complete' }
interface IConfig { readonly mode: 'trial' | 'normal'; readonly selected: readonly string[]; readonly trialPrCap: number | null }
interface IInputs { readonly config: IConfig }
interface ICorpus { readonly key: string; readonly prs: readonly string[]; readonly scope: 'full' | 'restricted'; readonly sourceExhausted: boolean }
interface ISummary { readonly key: string; readonly count: number; readonly scope: 'full' | 'restricted'; readonly sourceExhausted: boolean }
interface IReport { readonly required: readonly ISummary[]; readonly excluded: readonly string[] }
interface IHelpers {
  readonly roster: () => ISourceOutcome<IRoster>;
  readonly include: (config: ITrackedView<IConfig>, key: string) => boolean;
  readonly load: (person: ITrackedView<IPerson>, cap: number | null) => Promise<ICorpus>;
  readonly summarize: (value: ITrackedView<ICorpus>) => ISummary;
  readonly render: (entries: readonly IFoldEntry<ITrackedView<ISummary>>[]) => IReport;
}

/** Full synthetic upstream histories include complete empty data for the selected designer. */
const people: readonly IPerson[] = [
  { key: 'staff-1', role: 'staff', prs: ['s1a', 's1b', 's1c'] },
  { key: 'staff-2', role: 'staff', prs: ['s2a', 's2b'] },
  { key: 'design-1', role: 'designer', prs: [] },
  { key: 'pm-1', role: 'pm', prs: ['p1a', 'p1b', 'p1c', 'p1d'] },
  { key: 'pm-2', role: 'pm', prs: ['p2a'] },
  { key: 'staff-3', role: 'staff', prs: ['s3a', 's3b'] },
  { key: 'design-2', role: 'designer', prs: ['d2a', 'd2b', 'd2c'] },
  { key: 'pm-3', role: 'pm', prs: ['p3a'] },
];
const selected = ['staff-1', 'staff-2', 'design-1', 'pm-1', 'pm-2'];

test('authored trial widens with exact member reuse and isolated production; caps stay explicit and normal mode ignores trial-only policy', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-authored-trial-'));
  const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'accounting.sqlite'), logicalStore: 'authored-trial' });
  const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'authored-trial', accounting });
  const summaries: string[] = [];
  const receipts: { readonly key: string; readonly cap: number | null; readonly prs: readonly string[] }[] = [];
  const load = async (person: ITrackedView<IPerson>, cap: number | null): Promise<ICorpus> => currentExecution().operation<ICorpus>({
    name: 'history', binding: `fixture:${person.key}:${String(cap)}`,
    perform: () => {
      // An explicit cap labels the declared scope even when this page happens to fit.
      const restricted = cap !== null;
      const prs: string[] = [];
      for (let index = 0; index < person.prs.length && (cap === null || index < cap); index += 1) {
        const pr = person.prs[index];
        if (pr !== undefined) { prs.push(pr); }
      }
      receipts.push({ key: person.key, cap, prs });
      return Promise.resolve({ kind: 'succeeded', value: { key: person.key, prs, scope: restricted ? 'restricted' : 'full', sourceExhausted: !restricted }, usage: { report: 'history', quantities: [{ unit: 'requests', amount: 1 }] } });
    },
  });
  const include = (config: ITrackedView<IConfig>, key: string): boolean => {
    if (config.mode === 'normal') { return true; }
    for (let index = 0; index < config.selected.length; index += 1) { if (config.selected[index] === key) { return true; } }
    return false;
  };
  const roster = (): ISourceOutcome<IRoster> => sourceOutcome.fresh<IRoster>({ members: people, status: 'complete' });
  const summarize = (value: ITrackedView<ICorpus>): ISummary => {
    summaries.push(value.key);
    return { key: value.key, count: value.prs.length, scope: value.scope, sourceExhausted: value.sourceExhausted };
  };
  const render = (entries: readonly IFoldEntry<ITrackedView<ISummary>>[]): IReport => ({ required: entries.flatMap((entry) => entry.status === 'succeeded' ? [{ key: entry.data.key, count: entry.data.count, scope: entry.data.scope, sourceExhausted: entry.data.sourceExhausted }] : []), excluded: entries.filter((entry) => entry.status === 'skipped').map((entry) => entry.key) });
  const start = async (config: IConfig, key: string, environment = 'same') => {
    const builders = authoring<IInputs, IHelpers>();
    const rosterStep = builders.source<IRoster>({ subject: 'people', collection: { identity: 'key' }, finality: () => true, run: ({ helpers }) => helpers.roster() });
    const steps = (member: IMemberBuilder<IInputs, IHelpers, IPerson>) => {
      const corpus = member.memo({ subject: member.subject('corpus'), run: ({ member: person, helpers, inputs }) => helpers.load(person, inputs.config.mode === 'trial' ? inputs.config.trialPrCap : null) });
      const summary = member.memo({ subject: member.subject('summary'), children: { corpus }, run: async ({ calls, helpers }) => helpers.summarize((await calls.corpus()).data) });
      return { corpus, summary };
    };
    const person = builders.template({ slot: 'person', collection: rosterStep, gate: ({ member, inputs, helpers }) => helpers.include(inputs.config, member.key), steps });
    const report = builders.fold({ subject: 'organization-report', over: { template: person, step: 'summary' }, run: ({ members, helpers }) => helpers.render(members) });
    const composition = builders.compose({ scope: 'authored-trial', inputs: [{ slot: 'config', value: config }], helpers: [{ slot: 'include', helper: include }, { slot: 'roster', helper: roster }, { slot: 'load', helper: load }, { slot: 'summarize', helper: summarize }, { slot: 'render', helper: render }], steps: [{ slot: 'roster', declaration: rosterStep }, { slot: 'report', declaration: report }], templates: [person] });
    return workspace.run({ authoring: builders, composition, environment }, async (run) => {
      const folded = await run.resolveFold({ scope: 'authored-trial', role: 'step', slot: 'report' }, { requestKey: key });
      if (folded.outcome.status !== 'succeeded') { throw new Error(`unexpected ${folded.outcome.status}`); }
      return { ...run.read<IReport>(folded.outcome.outcome.reference), reportReference: folded.outcome.outcome.reference.locator, summaryReferences: Object.fromEntries(folded.members.flatMap((member) => member.status === 'succeeded' ? [[member.key, member.outcome.reference.locator]] : [])) };
    });
  };
  try {
    expect(people.filter((person) => selected.includes(person.key)).map((person) => person.role).sort()).toEqual(['designer', 'pm', 'pm', 'staff', 'staff']);
    // Widening changes aggregate membership, not still-valid member evidence.
    const narrowSelection = ['staff-1', 'design-1', 'pm-1'];
    const narrow = await start({ mode: 'trial', selected: narrowSelection, trialPrCap: null }, 'narrow-trial');
    expect(receipts.map((receipt) => receipt.key).sort()).toEqual([...narrowSelection].sort());
    expect(summaries.sort()).toEqual([...narrowSelection].sort());
    expect(narrow.value.required.map((person) => person.key).sort()).toEqual([...narrowSelection].sort());
    expect(narrow.value.excluded).toHaveLength(5);
    receipts.length = 0;
    summaries.length = 0;
    const full = await start({ mode: 'trial', selected, trialPrCap: null }, 'full-trial');
    expect(receipts.map((receipt) => receipt.key).sort()).toEqual(['pm-2', 'staff-2']);
    expect(summaries.sort()).toEqual(['pm-2', 'staff-2']);
    expect(full.value.reportReference).not.toBe(narrow.value.reportReference);
    for (const key of narrowSelection) {
      expect(narrow.value.summaryReferences[key]).toEqual(expect.any(String));
      expect(full.value.summaryReferences[key]).toBe(narrow.value.summaryReferences[key]);
    }
    expect(full.value.required).toHaveLength(5);
    for (const receipt of receipts) { expect(receipt.prs).toEqual(people.find((person) => person.key === receipt.key)?.prs); }
    for (const person of people.filter((person) => selected.includes(person.key))) {
      expect(full.value.required).toContainEqual({ key: person.key, count: person.prs.length, scope: 'full', sourceExhausted: true });
    }
    expect([...full.value.excluded].sort()).toEqual(['design-2', 'pm-3', 'staff-3']);
    receipts.length = 0;
    const capped = await start({ mode: 'trial', selected, trialPrCap: 1 }, 'capped-trial');
    expect(receipts.map((receipt) => receipt.key).sort()).toEqual([...selected].sort());
    expect(capped.value.required).toContainEqual({ key: 'pm-1', count: 1, scope: 'restricted', sourceExhausted: false });
    expect(capped.value.required).toContainEqual({ key: 'design-1', count: 0, scope: 'restricted', sourceExhausted: false });
    expect(capped.value.required.every((entry) => entry.scope === 'restricted' && !entry.sourceExhausted)).toBe(true);
    receipts.length = 0;
    const normal = await start({ mode: 'normal', selected, trialPrCap: 1 }, 'normal');
    expect(normal.value.required).toHaveLength(people.length);
    expect(normal.value.excluded).toEqual([]);
    for (const person of people) {
      expect(normal.value.required).toContainEqual({ key: person.key, count: person.prs.length, scope: 'full', sourceExhausted: true });
    }
    expect(receipts.every((receipt) => receipt.cap === null)).toBe(true);
    expect(receipts.map((receipt) => receipt.key)).toEqual(expect.arrayContaining(['design-2', 'pm-3', 'staff-3']));
    // Same shapes and trial identities cannot supply a production environment.
    receipts.length = 0;
    summaries.length = 0;
    const production = await start({ mode: 'normal', selected, trialPrCap: 1 }, 'production', 'production');
    expect(receipts.map((receipt) => receipt.key).sort()).toEqual(people.map((person) => person.key).sort());
    expect(summaries.sort()).toEqual(people.map((person) => person.key).sort());
    expect(production.value.required).toEqual(normal.value.required);
    expect(production.value.excluded).toEqual([]);
    for (const key of selected) {
      expect(production.value.summaryReferences[key]).not.toBe(full.value.summaryReferences[key]);
    }
  } finally { workspace.close(); accounting.close(); rmSync(directory, { recursive: true, force: true }); }
});
