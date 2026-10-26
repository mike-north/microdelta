/**
 * TEST-6 author-owned cost qualification. The facade owns durable execution;
 * this fixture owns deterministic CPU work, detached local filtering, scoped
 * History verification and independent acceptance assertions. Process metrics
 * describe whole phases, never private payload-load or fingerprint attribution.
 */
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { openDurableHistory } from '@microdelta/history';
import type { ICompletedResultReference, IDurableHistory, IVersionedSubject } from '@microdelta/history';
import { createNodeClock, createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import { createTracking } from '@microdelta/tracking';
import { authoring, openWorkspace } from 'microdelta';
import type { IFoldEntry, IMembersReport, ITrackedView, IWorkspaceRun } from 'microdelta';

/** Each keyed result deliberately separates the parent-consumed field from its unread sibling. @internal */
export interface ICostValue { readonly key: string; readonly selected: number; readonly sibling: number }
/** Exact immutable data is paired with identity explicitly; the local filter implies no subscription. @internal */
export interface ICostMember { readonly key: string; readonly reference: ICompletedResultReference; readonly value: ICostValue }
/** Fixed aggregate meaning is independent of the intentionally costly implementation. @internal */
export interface ICostAggregate { readonly total: number; readonly count: number }
/** Phase configuration is fixture input, with no provider or runtime-policy surface. @internal */
export interface IReactiveCostJob {
  readonly directory: string; readonly phase: 'cold' | 'restart'; readonly population: number;
  readonly memberIterations: number; readonly foldIterations: number; readonly leaseMilliseconds: number;
  readonly suppressCachedRead: boolean;
}
/** Counts arise at actual body entry. Observed active author attempts span public execute through terminal lifecycle events, including publication work; they do not measure simultaneous physical body CPU or configured permits. @internal */
export interface ICostBodies { expensive: number; leaf: number; parent: number; fold: number; roster: number; active: number; maximumActive: number; kernelCpuMicroseconds: number; memberKernelCpuMicroseconds: number; foldKernelCpuMicroseconds: number; kernelSink: number }
/** Complete only for this declared fixture analysis/environment/subject/version manifest. @internal */
export interface ICostCensus { readonly manifest: readonly IVersionedSubject[]; readonly results: number; readonly acceptances: number; readonly snapshots: readonly { readonly reference: ICompletedResultReference; readonly fingerprint: unknown; readonly envelope: unknown }[] }
/** Local views retain exact value/reference pairs; verification is outside the measured local interval. @internal */
export interface ICostFilter { readonly before: ICostCensus; readonly after: ICostCensus; readonly requestsBefore: number; readonly requestsAfter: number; readonly bodiesBefore: ICostBodies; readonly bodiesAfter: ICostBodies; readonly views: readonly (readonly ICostMember[])[]; readonly measurement: ICostMeasurement }
/** Node exposes process-wide I/O and a lifetime maxRSS; heap samples can miss synchronous CPU work. @internal */
export interface ICostMeasurement {
  readonly wallMilliseconds: number; readonly cpuMicroseconds: { readonly user: number; readonly system: number };
  readonly maxRssKibibytes: number; readonly sampledHeapBytes: number; readonly timerSamples: number;
  readonly processFileIo: { readonly reads: number; readonly writes: number }; readonly storeBytes: number;
}
/** Compact durable receipts retain actual outcomes and exact identities for every accepted phase. @internal */
export interface IReactiveCostReceipt {
  readonly phase: 'cold' | 'restart' | 'parent-only' | 'unread-child' | 'consumed-child' | 'unread-input' | 'membership';
  readonly pid: number; readonly members: readonly ICostMember[]; readonly parents: readonly { readonly key: string; readonly reference: ICompletedResultReference; readonly value: { readonly selected: number } }[];
  readonly aggregate: { readonly reference: ICompletedResultReference; readonly value: ICostAggregate };
  readonly requestWallMilliseconds: Readonly<Record<string, number>>; readonly bodies: ICostBodies; readonly measurement: ICostMeasurement; readonly filter?: ICostFilter;
  readonly refreshedView: readonly ICostMember[];
}
/** Current keyed inputs keep membership and independent per-key facts separate. */
interface ICostInputs {
  readonly keys: readonly string[]; readonly facts: Readonly<Record<string, { readonly selected: number; readonly sibling: number; readonly unread: number; readonly parentOnly: number }>>;
  readonly memberIterations: number; readonly foldIterations: number;
}
/** Helpers perform fixture CPU/ledger work while tracked callbacks choose every semantic input. */
interface ICostHelpers {
  missing(): never;
  roster(keys: ITrackedView<readonly string[]>): { readonly status: 'complete'; readonly members: readonly { readonly key: string }[] };
  sameKeys(keys: ITrackedView<readonly string[]>, prior: ITrackedView<{ readonly members: readonly { readonly key: string }[] }>): boolean;
  expensive(key: string, selected: number, sibling: number, iterations: number): Promise<ICostValue>;
  leaf(key: string, selected: number): { readonly key: string; readonly value: number };
  parent(key: string, selected: number, parentOnly: number): { readonly selected: number };
  selected(value: ITrackedView<ICostValue>): number;
  aggregate(members: readonly IFoldEntry<{ readonly key: string; readonly value: number }>[], iterations: number): ICostAggregate;
}
/** Stable fixture scope makes its complete public History manifest enumerable without private SQL. */
const analysis = 'test6-reactive-cost';
/** This qualification never promotes or crosses environments. */
const environment = 'qualification';
/** Public History and Workspace agree on the same separate logical store. */
const logicalStore = 'test6-reactive-cost-history';

/** Positive bounded integers make malformed CLI work fail before opening a store. @internal */
export function validateReactiveCostJob(value: unknown): IReactiveCostJob {
  if (typeof value !== 'object' || value === null) { throw new Error('invalid cost job'); }
  const directory: unknown = Reflect.get(value, 'directory');
  const phase: unknown = Reflect.get(value, 'phase');
  const population: unknown = Reflect.get(value, 'population');
  const memberIterations: unknown = Reflect.get(value, 'memberIterations');
  const foldIterations: unknown = Reflect.get(value, 'foldIterations');
  const leaseMilliseconds: unknown = Reflect.get(value, 'leaseMilliseconds');
  const suppressCachedRead: unknown = Reflect.get(value, 'suppressCachedRead');
  if (typeof directory !== 'string' || directory.length === 0 || (phase !== 'cold' && phase !== 'restart') || typeof suppressCachedRead !== 'boolean'
    || typeof population !== 'number' || !Number.isSafeInteger(population) || population < 16 || population > 512
    || typeof memberIterations !== 'number' || !Number.isSafeInteger(memberIterations) || memberIterations < 1
    || typeof foldIterations !== 'number' || !Number.isSafeInteger(foldIterations) || foldIterations < 1
    || typeof leaseMilliseconds !== 'number' || !Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds < 1) { throw new Error('invalid cost job'); }
  return { directory, phase, population, memberIterations, foldIterations, leaseMilliseconds, suppressCachedRead };
}

/** One deterministic bounded integer recurrence burns CPU and leaves a consumed fixture-ledger sink. */
function kernel(iterations: number): number {
  let state = 0x12345678;
  for (let index = 0; index < iterations; index += 1) { state = Math.imul(state ^ (state >>> 13), 1_664_525) + 1_013_904_223 | 0; }
  return state;
}
/** All body counters start fresh for each phase, even when the workspace remains open. */
function counts(): ICostBodies { return { expensive: 0, leaf: 0, parent: 0, fold: 0, roster: 0, active: 0, maximumActive: 0, kernelCpuMicroseconds: 0, memberKernelCpuMicroseconds: 0, foldKernelCpuMicroseconds: 0, kernelSink: 0 }; }
/** Timer and endpoint samples document their limits rather than claiming an exact heap high-water mark. */
async function measure<T>(location: string, body: () => Promise<T>): Promise<{ readonly value: T; readonly measurement: ICostMeasurement }> {
  const started = performance.now(); const cpu = process.cpuUsage(); const usage = process.resourceUsage();
  let sampledHeapBytes = process.memoryUsage().heapUsed; let timerSamples = 0;
  const timer = setInterval(() => { timerSamples += 1; sampledHeapBytes = Math.max(sampledHeapBytes, process.memoryUsage().heapUsed); }, 10);
  try {
    const value = await body(); const delta = process.cpuUsage(cpu); const after = process.resourceUsage();
    sampledHeapBytes = Math.max(sampledHeapBytes, process.memoryUsage().heapUsed);
    return { value, measurement: { wallMilliseconds: performance.now() - started, cpuMicroseconds: delta, maxRssKibibytes: after.maxRSS, sampledHeapBytes, timerSamples, processFileIo: { reads: after.fsRead - usage.fsRead, writes: after.fsWrite - usage.fsWrite }, storeBytes: statSync(location).size } };
  } finally { clearInterval(timer); }
}
/** Enumerate every possible subject/version, including the one possible added key, independent of runtime results. */
function manifest(population: number): readonly IVersionedSubject[] {
  const subjects = ['roster', 'aggregate'];
  for (let index = 0; index <= population; index += 1) { for (const prefix of ['expensive', 'leaf', 'parent']) { subjects.push(`${prefix}:key-${String(index).padStart(3, '0')}`); } }
  return subjects.map(subject => ({ analysis, environment, subject, version: 1 }));
}
/** Two read-only public History inspections bracket only settled local-cell changes. */
function census(history: IDurableHistory, population: number): ICostCensus {
  const declared = manifest(population);
  const candidates = declared.flatMap(subject => history.findCandidates(subject));
  const unique = new Map(candidates.map(envelope => [envelope.reference.locator, envelope.reference]));
  let acceptances = 0;
  const snapshots = [...unique.values()].sort((a, b) => a.locator.localeCompare(b.locator)).map(reference => {
    acceptances += history.readAcceptances(reference, environment).length;
    const envelope = history.readEnvelope(reference);
    return { reference, envelope: { publication: envelope.publication, attemptId: envelope.attemptId, version: envelope.version, analysis: envelope.analysis, environment: envelope.environment, subject: envelope.subject, encoding: envelope.encoding, provenanceSha256: createHash('sha256').update(JSON.stringify(envelope.provenance)).digest('hex'), dependenciesSha256: createHash('sha256').update(JSON.stringify(envelope.dependencies)).digest('hex') }, fingerprint: history.reader.resolveFingerprint(reference, { kind: 'materialized-output', encoding: 'MDS1', address: [] }) };
  });
  return { manifest: declared, results: unique.size, acceptances, snapshots };
}
/** Exact data read inside a live run is detached and must never be credited as observed child output. */
function readMembers(run: IWorkspaceRun, report: IMembersReport): readonly ICostMember[] {
  return report.members.map(member => {
    if (member.status !== 'succeeded') { throw new Error(`member ${member.key}: ${member.status}`); }
    return { key: member.key, reference: member.outcome.reference, value: run.read<ICostValue>(member.outcome.reference) };
  });
}

/** Reconstruct a fresh process-local graph, tracker and tags over the existing durable store. @internal */
export async function runReactiveCost(job: IReactiveCostJob): Promise<readonly IReactiveCostReceipt[]> {
  const location = join(job.directory, 'history.sqlite');
  const workspace = openWorkspace({ location, logicalStore, leaseMilliseconds: job.leaseMilliseconds });
  const history = openDurableHistory({ location, logicalStore, sqlite: createNodeSqlite(), clock: createNodeClock(), sha256: createNodeMachine() });
  const tracking = createTracking(createNodeMachine());
  const criterion = tracking.cell(0);
  const localValues = tracking.cell<readonly ICostMember[]>([]);
  const view = tracking.derived(() => localValues.get().filter(member => member.value.selected >= criterion.get()));
  let bodies = counts();
  /** CPU accounting covers the fixture kernels alone; broader phase measurements include runtime/storage work. */
  const burn = (iterations: number, kind: 'member' | 'fold'): void => { const cpu = process.cpuUsage(); bodies.kernelSink ^= kernel(iterations); const delta = process.cpuUsage(cpu); const elapsed = delta.user + delta.system; bodies.kernelCpuMicroseconds += elapsed; if (kind === 'member') { bodies.memberKernelCpuMicroseconds += elapsed; } else { bodies.foldKernelCpuMicroseconds += elapsed; } };
  const helpers: ICostHelpers = {
    missing() { throw new Error('missing fact'); },
    roster(keys) { bodies.roster += 1; const members: { readonly key: string }[] = []; for (let index = 0; index < keys.length; index += 1) { const key = keys[index]; if (key === undefined) { throw new Error('missing key'); } members.push({ key }); } return { status: 'complete', members }; },
    sameKeys(keys, prior) { if (keys.length !== prior.members.length) { return false; } for (let index = 0; index < keys.length; index += 1) { if (keys[index] !== prior.members[index]?.key) { return false; } } return true; },
    async expensive(key, selected, sibling, iterations) { bodies.expensive += 1; await Promise.resolve(); burn(iterations, 'member'); return { key, selected: selected * 3, sibling }; },
    leaf(key, selected) { bodies.leaf += 1; return { key, value: selected * 2 }; },
    parent(_key, selected, parentOnly) { bodies.parent += 1; return { selected: selected + parentOnly }; },
    // The negative author mutation omits the selected-field read while retaining
    // the child call. Its zero value is correct until the consumed-field control.
    selected(value) { return job.suppressCachedRead && value.key === 'key-000' ? 3 : value.selected; },
    aggregate(members, iterations) { bodies.fold += 1; let total = 0; for (const member of members) { if (member.status !== 'succeeded') { throw new Error('strict fold missing member'); } total += member.data.value; } burn(iterations, 'fold'); return { total, count: members.length }; },
  };
  const api = authoring<ICostInputs, ICostHelpers>();
  const roster = api.source<{ readonly status: 'complete'; readonly members: readonly { readonly key: string }[] }>({ subject: 'roster', collection: { identity: 'key' }, finality: ({ previous, inputs, helpers }) => helpers.sameKeys(inputs.keys, previous.data), run: ({ inputs, helpers, outcome }) => outcome.fresh(helpers.roster(inputs.keys)) });
  const members = api.template({ slot: 'member', collection: roster, steps: member => {
    const expensive = member.memo({ subject: member.subject('expensive'), run: ({ member, inputs, helpers }) => { const fact = inputs.facts[member.key]; if (fact === undefined) { return helpers.missing(); } return helpers.expensive(member.key, fact.selected, fact.sibling, inputs.memberIterations); } });
    const leaf = member.memo({ subject: member.subject('leaf'), run: ({ member, inputs, helpers }) => { const fact = inputs.facts[member.key]; if (fact === undefined) { return helpers.missing(); } return helpers.leaf(member.key, fact.selected); } });
    const parent = member.memo({ subject: member.subject('parent'), children: { expensive }, run: async ({ calls, member, inputs, helpers }) => { const child = await calls.expensive(); const fact = inputs.facts[member.key]; if (fact === undefined) { return helpers.missing(); } return helpers.parent(member.key, helpers.selected(child.data), fact.parentOnly); } });
    return { expensive, leaf, parent };
  } });
  const aggregate = api.fold({ subject: 'aggregate', over: { template: members, step: 'leaf' }, run: ({ members, inputs, helpers }) => helpers.aggregate(members, inputs.foldIterations) });
  const baseKeys = Array.from({ length: job.population }, (_, index) => `key-${String(index).padStart(3, '0')}`);
  let keys = baseKeys;
  let facts: ICostInputs['facts'] = Object.fromEntries(Array.from({ length: job.population + 1 }, (_, index) => [`key-${String(index).padStart(3, '0')}`, { selected: index + 1, sibling: 100 + index, unread: 0, parentOnly: 0 }]));
  const receipts: IReactiveCostReceipt[] = [];
  /** A changed input always enters through a newly composed tracked input binding. */
  const phase = async (name: IReactiveCostReceipt['phase'], filter: boolean): Promise<void> => {
    bodies = counts();
    const composition = api.compose({ scope: analysis, inputs: [{ slot: 'keys', value: keys }, { slot: 'facts', value: facts }, { slot: 'memberIterations', value: job.memberIterations }, { slot: 'foldIterations', value: job.foldIterations }],
      helpers: [{ slot: 'missing', helper: helpers.missing }, { slot: 'roster', helper: helpers.roster }, { slot: 'sameKeys', helper: helpers.sameKeys }, { slot: 'expensive', helper: helpers.expensive }, { slot: 'leaf', helper: helpers.leaf }, { slot: 'parent', helper: helpers.parent }, { slot: 'selected', helper: helpers.selected }, { slot: 'aggregate', helper: helpers.aggregate }], steps: [{ slot: 'roster', declaration: roster }, { slot: 'aggregate', declaration: aggregate }], templates: [members] });
    let requests = 0;
    const requestWallMilliseconds: Record<string, number> = {};
    const request = async <T>(label: string, body: () => Promise<T>): Promise<T> => { requests += 1; const start = performance.now(); try { return await body(); } finally { requestWallMilliseconds[label] = performance.now() - start; } };
    const active = new Set<string>();
    const measured = await measure(location, () => workspace.run({ authoring: api, composition, environment, window: 8, observers: [{ observe(event) {
      if (event.kind !== 'step') { return; }
      const identity = JSON.stringify(event.event.step);
      if (event.event.phase === 'execute') { active.add(identity); }
      else if (['publish', 'accept', 'release', 'abandon'].includes(event.event.phase)) { active.delete(identity); }
      bodies.active = active.size; bodies.maximumActive = Math.max(bodies.maximumActive, active.size);
    } }] }, async run => {
      const resolved = await request('expensive-members', () => run.resolveMembers({ template: 'member', step: 'expensive' }, { requestKey: `${name}:members` }));
      const folded = await request('aggregate', () => run.resolveFold({ scope: analysis, role: 'step', slot: 'aggregate' }, { requestKey: `${name}:fold` }));
      const parents = await request('parents', () => run.resolveMembers({ template: 'member', step: 'parent' }, { requestKey: `${name}:parents` }));
      if (folded.outcome.status !== 'succeeded') { throw new Error(`fold ${folded.outcome.status}`); }
      const values = readMembers(run, resolved);
      localValues.set(values);
      criterion.set(40);
      const refreshedView = view.get();
      const accepted = { members: values, aggregate: { reference: folded.outcome.outcome.reference, value: run.read<ICostAggregate>(folded.outcome.outcome.reference) }, parents: parents.members.map(member => { if (member.status !== 'succeeded') { throw new Error(`parent ${member.status}`); } return { key: member.key, reference: member.outcome.reference, value: run.read<{ readonly selected: number }>(member.outcome.reference) }; }), refreshedView };
      if (!filter) { return accepted; }
      const before = census(history, job.population); const bodiesBefore = { ...bodies }; const requestsBefore = requests;
      const local = await measure(location, async () => { const views: (readonly ICostMember[])[] = []; for (const next of [0, 10_000, 40, 40]) { criterion.set(next); views.push(view.get()); } return views; });
      const after = census(history, job.population);
      return { ...accepted, filter: { before, after, requestsBefore, requestsAfter: requests, bodiesBefore, bodiesAfter: { ...bodies }, views: local.value, measurement: local.measurement } };
    }));
    receipts.push({ phase: name, pid: process.pid, ...measured.value.value, requestWallMilliseconds, bodies: { ...bodies }, measurement: measured.measurement });
  };
  /** Only key-000 changes; all other identities and fact bindings remain independently fixed. */
  const change = (field: 'selected' | 'sibling' | 'unread' | 'parentOnly', value: number): void => { const prior = facts['key-000']; if (prior === undefined) { throw new Error('missing control key'); } facts = { ...facts, 'key-000': { ...prior, [field]: value } }; };
  try {
    await phase(job.phase, true);
    if (job.phase === 'restart') {
      change('parentOnly', 7); await phase('parent-only', false);
      change('sibling', 900); await phase('unread-child', false);
      change('selected', 20); await phase('consumed-child', false);
      change('unread', 8); await phase('unread-input', false);
      keys = [...baseKeys, `key-${String(job.population).padStart(3, '0')}`]; await phase('membership', false);
    }
    return receipts;
  } finally { history.close(); workspace.close(); }
}

/** Throw bounded, phase-specific evidence failures; the negative control must reach the consumed-output check. @internal */
export function assertReactiveCostQualification(receipts: readonly IReactiveCostReceipt[], population: number): void {
  if (!Number.isSafeInteger(population) || population < 16) { throw new Error('population must be at least 16'); }
  const phases = ['cold', 'restart', 'parent-only', 'unread-child', 'consumed-child', 'unread-input', 'membership'];
  if (receipts.length !== phases.length || receipts.some((receipt, index) => receipt.phase !== phases[index])) { throw new Error('phase sequence incomplete'); }
  const cold = receipts[0]; if (cold === undefined) { throw new Error('phase cold missing'); }
  const same = (actual: unknown, expected: unknown, message: string): void => { if (!isDeepStrictEqual(actual, expected)) { throw new Error(message); } };
  for (const receipt of receipts) {
    const changed = ['consumed-child', 'unread-input', 'membership'].includes(receipt.phase);
    const count = population + (receipt.phase === 'membership' ? 1 : 0);
    const expected = Array.from({ length: count }, (_, index) => ({ key: `key-${String(index).padStart(3, '0')}`, selected: (changed && index === 0 ? 20 : index + 1) * 3, sibling: index === 0 && ['unread-child', 'consumed-child', 'unread-input', 'membership'].includes(receipt.phase) ? 900 : 100 + index }));
    same(receipt.members.map(member => member.value), expected, `${receipt.phase} member values`);
    same(receipt.members.map(member => member.key), expected.map(value => value.key), `${receipt.phase} keys`);
    same(receipt.aggregate.value, { count, total: count * (count + 1) + (changed ? 38 : 0) }, `${receipt.phase} aggregate values`);
    same(receipt.refreshedView, receipt.members.filter(member => member.value.selected >= 40), `${receipt.phase} explicit local refresh`);
    const expectedBodies = receipt.phase === 'cold' ? [population, population, population, 1] : receipt.phase === 'restart' || receipt.phase === 'unread-input' ? [0, 0, 0, 0] : receipt.phase === 'parent-only' ? [0, 0, 1, 0] : receipt.phase === 'unread-child' ? [1, 0, 0, 0] : [1, 1, 1, 1];
    same([receipt.bodies.expensive, receipt.bodies.leaf, receipt.bodies.parent, receipt.bodies.fold], expectedBodies, `${receipt.phase} parent execution or cost-body cutoff`);
    same(receipt.parents.map(parent => parent.value), expected.map((value, index) => ({ selected: value.selected + (index === 0 && !['cold', 'restart'].includes(receipt.phase) ? 7 : 0) })), `${receipt.phase} parent values`);
    for (const member of receipt.members) {
      const initial = cold.members.find(value => value.key === member.key);
      if (initial !== undefined && (member.key !== 'key-000' || ['cold', 'restart', 'parent-only'].includes(receipt.phase))) { same(member.reference, initial.reference, `${receipt.phase} exact unchanged member`); }
    }
    const filter = receipt.filter;
    if (filter !== undefined) {
      same(filter.before, filter.after, `${receipt.phase} filter wrote fixture snapshots or acceptances`);
      same(filter.requestsBefore, 3, `${receipt.phase} settled request count`);
      same(filter.requestsAfter, filter.requestsBefore, `${receipt.phase} filter started requests`);
      for (const snapshot of filter.before.snapshots) { if (!record(snapshot.fingerprint) || snapshot.fingerprint['kind'] !== 'compatible') { throw new Error('unavailable retained payload fingerprint'); } }
      same(filter.bodiesBefore, filter.bodiesAfter, `${receipt.phase} filter executed bodies`);
      same(filter.before.results, 3 * population + 2, `${receipt.phase} complete manifest census`);
      const expectedViews = [receipt.members, [], receipt.members.filter(member => member.value.selected >= 40), receipt.members.filter(member => member.value.selected >= 40)];
      same(filter.views, expectedViews, `${receipt.phase} filter exact value/reference views`);
    }
  }
  const restart = receipts[1]; const prime = receipts[2]; const unread = receipts[3]; const consumed = receipts[4];
  if (restart === undefined || prime === undefined || unread === undefined || consumed === undefined) { throw new Error('phase oracle missing'); }
  if (cold.pid === restart.pid) { throw new Error('restart needs a fresh OS process'); }
  same(restart.aggregate.reference, cold.aggregate.reference, 'restart exact aggregate');
  same(restart.parents, cold.parents, 'restart exact parents');
  same(prime.aggregate.reference, cold.aggregate.reference, 'parent-only exact aggregate');
  same(unread.aggregate.reference, cold.aggregate.reference, 'unread-child exact aggregate');
  for (const receipt of receipts.slice(1)) { for (const parent of receipt.parents.slice(1, population)) { same(parent.reference, cold.parents.find(initial => initial.key === parent.key)?.reference, `${receipt.phase} unchanged parent identity`); } }
  same(prime.members[0]?.reference, cold.members[0]?.reference, 'parent-only cached child exact identity');
  same(unread.parents[0]?.reference, prime.parents[0]?.reference, 'unread-child parent exact identity');
  if (JSON.stringify(unread.members[0]?.reference) === JSON.stringify(prime.members[0]?.reference)) { throw new Error('unread-child needs new child identity'); }
  if (JSON.stringify(consumed.parents[0]?.reference) === JSON.stringify(unread.parents[0]?.reference)) { throw new Error('consumed-child parent execution identity'); }
}

/** JSON receipts cross an OS-process boundary; validate every field consumed by the acceptance oracle. @internal */
export function parseReactiveCostReceipts(text: string): readonly IReactiveCostReceipt[] {
  const decoded: unknown = JSON.parse(text);
  if (!Array.isArray(decoded) || !decoded.every(isReceipt)) { throw new Error('invalid cost receipt'); }
  return decoded;
}
/** A record check narrows JSON without assertion casts or unchecked property access. */
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** All counts and measured costs are finite nonnegative numeric facts. */
function numericFields(value: unknown, fields: readonly string[]): boolean { return record(value) && fields.every(field => typeof value[field] === 'number' && Number.isFinite(value[field]) && value[field] >= 0); }
/** References remain opaque, with only the public discriminator and string carrier checked. */
function reference(value: unknown): value is ICompletedResultReference { return record(value) && value['kind'] === 'completed-result' && typeof value['locator'] === 'string' && value['locator'].length > 0; }
/** Receipt values need independent scalar narrowing before the behavior oracle can trust their shapes. */
function isMember(value: unknown): value is ICostMember { return record(value) && typeof value['key'] === 'string' && reference(value['reference']) && record(value['value']) && typeof value['value']['key'] === 'string' && numericFields(value['value'], ['selected', 'sibling']); }
/** Body ledgers include a signed recurrence sink as well as nonnegative execution and CPU counts. */
function isBodies(value: unknown): value is ICostBodies { return numericFields(value, ['expensive', 'leaf', 'parent', 'fold', 'roster', 'active', 'maximumActive', 'kernelCpuMicroseconds', 'memberKernelCpuMicroseconds', 'foldKernelCpuMicroseconds']) && record(value) && typeof value['kernelSink'] === 'number'; }
/** Process metrics retain explicit numeric units; no attribution is inferred while decoding. */
function isMeasurement(value: unknown): value is ICostMeasurement { return record(value) && numericFields(value, ['wallMilliseconds', 'maxRssKibibytes', 'sampledHeapBytes', 'timerSamples', 'storeBytes']) && numericFields(value['cpuMicroseconds'], ['user', 'system']) && numericFields(value['processFileIo'], ['reads', 'writes']); }
/** Manifest entries are the public History lookup tuple, including the compatibility version. */
function isSubject(value: unknown): value is IVersionedSubject { return record(value) && ['analysis', 'environment', 'subject'].every(key => typeof value[key] === 'string') && value['version'] === 1; }
/** Unknown envelope/fingerprint payloads are compared as data and never treated as executable authority. */
function isCensus(value: unknown): value is ICostCensus { return record(value) && numericFields(value, ['results', 'acceptances']) && Array.isArray(value['manifest']) && value['manifest'].every(isSubject) && Array.isArray(value['snapshots']) && value['snapshots'].every((snapshot: unknown) => record(snapshot) && reference(snapshot['reference']) && 'fingerprint' in snapshot && 'envelope' in snapshot); }
/** Filter verification includes both endpoints and every exact local view. */
function isFilter(value: unknown): value is ICostFilter { return record(value) && numericFields(value, ['requestsBefore', 'requestsAfter']) && isCensus(value['before']) && isCensus(value['after']) && isBodies(value['bodiesBefore']) && isBodies(value['bodiesAfter']) && isMeasurement(value['measurement']) && Array.isArray(value['views']) && value['views'].every((view: unknown) => Array.isArray(view) && view.every(isMember)); }
/** A complete phase is accepted only after its nested data has been structurally narrowed. */
function isReceipt(value: unknown): value is IReactiveCostReceipt {
  return record(value) && ['cold', 'restart', 'parent-only', 'unread-child', 'consumed-child', 'unread-input', 'membership'].includes(String(value['phase'])) && numericFields(value, ['pid'])
    && Array.isArray(value['members']) && value['members'].every(isMember) && Array.isArray(value['parents']) && value['parents'].every((parent: unknown) => record(parent) && typeof parent['key'] === 'string' && reference(parent['reference']) && numericFields(parent['value'], ['selected']))
    && record(value['aggregate']) && reference(value['aggregate']['reference']) && numericFields(value['aggregate']['value'], ['total', 'count']) && numericFields(value['requestWallMilliseconds'], ['expensive-members', 'aggregate', 'parents']) && isBodies(value['bodies']) && isMeasurement(value['measurement'])
    && Array.isArray(value['refreshedView']) && value['refreshedView'].every(isMember) && (value['filter'] === undefined || isFilter(value['filter']));
}
