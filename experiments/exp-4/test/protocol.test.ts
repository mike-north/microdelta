/**
 * EXP-4 single-process assertions for the candidate mechanisms. Restart
 * behavior is proven separately in `restart.test.ts`; these cases cover record
 * shape, composition enforcement, keyed collection diagnostics, gates and the
 * strict fold's outcome distinctions.
 *
 * @see ../../../docs/spec/experiments.md (EXP-0, EXP-4)
 * @see ../../../docs/spec/composition.md (CMP-1..CMP-9)
 * @see ../../../docs/spec/execution.md (REUSE-005..REUSE-007)
 * @see ../../../docs/spec/tracking.md (COL-1..COL-4)
 * @see ../../../docs/spec/operations.md (RUN-005, RUN-010)
 */
import { beforeEach, describe, expect, test } from '@jest/globals';

import { compose, decode, encode, forward, parseRecord, runPass, step } from '../src/protocol.js';
import type { IContext, IData, IInvocationRecord, IPassReport, ISupervision } from '../src/protocol.js';
import {
  activityGate,
  constantAssessor,
  emptyCallBody,
  gateEvaluations,
  greedyReport,
  paid,
  relayAssessor,
  relayBody,
  summaryOptional,
  summaryWithCallback,
  summaryWithPeek,
  truthyGate,
} from './bodies.js';
import { baseData, buildGraph, dave, erin, MemoryHistory, sourcesFor } from './fixture.js';
import type { IFixtureData, IGraphOptions } from './fixture.js';

/** One pass over fresh fixture objects against a shared History. */
function pass(
  options: IGraphOptions,
  data: IFixtureData,
  history: MemoryHistory,
  supervision: ISupervision = {},
): { readonly report: IPassReport; readonly hookCalls: Record<string, number> } {
  const built = buildGraph(options);
  const { sources, hookCalls } = sourcesFor(data, options.collectionSlot);
  return { report: runPass(built.graph, sources, history, supervision), hookCalls };
}

/** Records for a template step instance, newest last. */
function recordsFor(history: MemoryHistory, slot: string, key: string): readonly IInvocationRecord[] {
  return history.records.filter(record => record.descriptor.slot === slot && record.descriptor.memberKey === key);
}

beforeEach(() => {
  paid.length = 0;
  gateEvaluations.length = 0;
});

describe('nested invocation record v2 (candidate 1)', () => {
  test('a summary records ordered calls with derived and forwarded recipes and consumed child facts', () => {
    const history = new MemoryHistory();
    pass({}, baseData(), history);
    const [alice] = recordsFor(history, 'summary', 'c-1');
    expect(alice?.calls.map(call => call.index)).toEqual([0, 1]);
    expect(alice?.calls[0]?.child).toMatchObject({ role: 'callable', slot: 'assessor' });
    expect(alice?.calls[0]?.arguments).toEqual({
      form: 'list',
      items: [
        { form: 'derived', value: encode('pr-1'), justified: true },
        { form: 'forwarded', origin: ['input', 'pulls'] },
      ],
    });
    expect(alice?.observations).toContainEqual({ kind: 'child-read', call: 1, path: ['score'], fact: encode(1) });
    expect(alice?.observations).toContainEqual({ kind: 'read', path: ['member', 'prs'], fact: encode(['pr-1', 'pr-2']) });
    // The forwarded PR table is not the parent's own evidence; only the child observes it.
    expect(alice?.observations.some(observation => observation.path[0] === 'input')).toBe(false);
  });

  test('the child observes forwarded data under argument paths and its identity ignores forwarded values', () => {
    const history = new MemoryHistory();
    pass({}, baseData(), history);
    const child = history.records.find(record => record.descriptor.role === 'callable' && record.observations
      .some(observation => observation.kind === 'read' && observation.fact === encode('pr-1')));
    expect(child?.observations).toContainEqual({ kind: 'read', path: ['argument', 1, 'pr-1', 'size'], fact: encode(150) });
    expect(child?.identity).not.toContain('Refactor');
    expect(child?.implementation).toContain('A: ');
  });

  test('a function argument is recorded as unreconstructible, never as a value', () => {
    const history = new MemoryHistory();
    pass({ summary: summaryWithCallback }, baseData(), history);
    const [alice] = recordsFor(history, 'summary', 'c-1');
    const items = alice?.calls[0]?.arguments;
    expect(items).toMatchObject({ form: 'list' });
    expect(items?.form === 'list' ? items.items[2] : undefined).toEqual({ form: 'unreconstructible', reason: 'function' });
    // The parent's own implementation text legitimately mentions the callback; its call recipes must not.
    expect(JSON.stringify(history.records.map(record => record.calls))).not.toMatch(/toUpperCase/u);
  });

  test('an argument-free call uses the M3 empty form', () => {
    const history = new MemoryHistory();
    pass({ summary: emptyCallBody, supplied: constantAssessor }, baseData(), history);
    const [alice] = recordsFor(history, 'summary', 'c-1');
    expect(alice?.calls[0]?.arguments).toEqual({ form: 'empty' });
  });

  test('a derived argument following an untracked peek is recorded unjustified', () => {
    const history = new MemoryHistory();
    pass({ summary: summaryWithPeek }, baseData(), history);
    const [alice] = recordsFor(history, 'summary', 'c-1');
    expect(alice?.observations[0]).toEqual({ kind: 'untracked', path: ['input', 'config', 'unread'] });
    expect(alice?.calls[0]?.arguments).toMatchObject({ form: 'list', items: [{ form: 'derived', justified: false }, { form: 'forwarded' }] });
  });

  test('forwarded origins resolve from current bindings, including an earlier child output', () => {
    const history = new MemoryHistory();
    const data = baseData();
    const relayData = (note: string): IFixtureData => ({
      ...data,
      contributors: [{ id: 'c-1', login: 'alice', bio: note, activity: 5, prs: [] }],
    });
    const options: IGraphOptions = { summary: relayBody, supplied: relayAssessor };
    const work = (): readonly string[] => paid.filter(entry => entry !== 'report');
    pass(options, relayData('hello world'), history);
    expect(work()).toEqual(['chain:c-1', 'relay:hello world', 'relay:HELLO WORLD']);
    paid.length = 0;
    // Same length (child 0's consumed `long` is equal), different text: child 1 must see the
    // *current* output of child 0, so it reruns and the parent observes its changed text.
    const second = pass(options, relayData('hello there'), history).report;
    expect(work()).toEqual(['relay:hello there', 'relay:HELLO THERE', 'chain:c-1']);
    expect(second.members['c-1']?.summary).toMatchObject({ status: 'succeeded', decision: 'changed-child-output' });
  });

  test('own evidence is validated before argument recipes: a changed read reports changed evidence', () => {
    const history = new MemoryHistory();
    pass({ summary: summaryWithCallback }, baseData(), history);
    const data = baseData();
    data.contributors[0] = { ...dave, id: 'c-1', login: 'alice-renamed', activity: 5, prs: ['pr-1', 'pr-2'] };
    const { report } = pass({ summary: summaryWithCallback }, data, history);
    expect(report.members['c-1']?.summary).toMatchObject({ decision: 'changed-evidence' });
    expect(report.members['c-3']?.summary).toMatchObject({ decision: 'unreconstructible-argument' });
  });

  test('records survive JSON and reject malformed durable input', () => {
    const history = new MemoryHistory();
    pass({}, baseData(), history);
    const roundTrip: unknown = JSON.parse(JSON.stringify(history.records));
    expect(Array.isArray(roundTrip) ? roundTrip.map(parseRecord) : undefined).toEqual(history.records);
    const [first] = history.records;
    expect(() => parseRecord({ ...first, version: 1 })).toThrow(TypeError);
    expect(() => parseRecord({ ...first, calls: [{ index: 0, child: first?.descriptor, arguments: { form: 'guessed' }, identity: 'x', reference: 'r' }] })).toThrow(TypeError);
    expect(() => parseRecord({ ...first, observations: [{ kind: 'read', path: ['member'], fact: 7 }] })).toThrow(TypeError);
    expect(() => parseRecord(null)).toThrow(TypeError);
    expect(JSON.stringify(history.records)).not.toMatch(/"(closure|function|__tag|revision)"/u);
  });

  test('successful undefined output has canonical text distinct from every data value', () => {
    expect(encode(undefined)).not.toBe(encode(null));
    expect(decode(encode(undefined))).toBeUndefined();
    expect(encode({ b: 1, a: 2 })).toBe(encode({ a: 2, b: 1 }));
    expect(encode([1, 2])).not.toBe(encode([2, 1]));
  });
});

describe('supplied callable slot and fixed topology (candidates 2 and 3; A-08, CMP-9)', () => {
  test('the template factory runs exactly once regardless of member count', () => {
    const built = buildGraph();
    const history = new MemoryHistory();
    const data = baseData();
    data.contributors.push(dave, erin);
    runPass(built.graph, sourcesFor(data).sources, history, {});
    runPass(built.graph, sourcesFor(baseData()).sources, history, {});
    expect(built.factoryCalls()).toBe(1);
  });

  test('post-freeze builder-array mutation and late declarations cannot change topology', () => {
    const built = buildGraph();
    const before = [...built.graph.topology];
    const late = built.lateTemplate();
    expect(() => late?.memo('extra', activityGate, [])).toThrow(/frozen/u);
    expect(() => built.lateBuilder()?.input('late')).toThrow(/frozen/u);
    const [summary] = built.templateArray;
    if (summary !== undefined) {
      built.templateArray.push(summary, summary);
    }
    built.templateArray.length = 0;
    expect(built.graph.topology).toEqual(before);
    runPass(built.graph, sourcesFor(baseData()).sources, new MemoryHistory(), {});
    expect(paid.filter(entry => entry.startsWith('summary:'))).toEqual(['summary:c-1', 'summary:c-3']);
  });

  test('swapping the supplied implementation does not change the abstract graph', () => {
    expect(buildGraph({ assessor: 'B' }).graph.topology).toEqual(buildGraph({ assessor: 'A' }).graph.topology);
    expect(buildGraph({ reversed: true }).graph.topology).toEqual(buildGraph().graph.topology);
    expect(buildGraph({ summarySlot: 'profile' }).graph.topology).not.toEqual(buildGraph().graph.topology);
  });

  test('a callable created from a result, or an undeclared slot, is rejected before any paid work', () => {
    const resultCreated = compose('result-created', builder => {
      const assessor = builder.callable('assessor');
      builder.supply(assessor, step(constantAssessor, 'constant'));
      builder.input('config');
      const discovery = builder.collection('discovery');
      builder.fanout('contributor', {
        collection: discovery,
        template: member => [member.memo('summary', context => {
          const login = context.read(['member', 'login']);
          const created = (): string => String(login);
          Reflect.apply(context.call, context, [created]);
          return login;
        }, [assessor])],
      });
    });
    const undeclared = compose('undeclared', builder => {
      const assessor = builder.callable('assessor');
      builder.supply(assessor, step(constantAssessor, 'constant'));
      const discovery = builder.collection('discovery');
      builder.fanout('contributor', {
        collection: discovery,
        template: member => [member.memo('summary', context => context.call('scorer').read(['score']), [assessor])],
      });
    });
    for (const graph of [resultCreated, undeclared]) {
      const report = runPass(graph, sourcesFor(baseData()).sources, new MemoryHistory(), {});
      expect(report.members['c-1']?.summary).toMatchObject({ status: 'failed', diagnostic: expect.stringMatching(/undeclared call/u) });
    }
    expect(paid.filter(entry => entry.startsWith('constant:'))).toEqual([]);
  });

  test('a body cannot add an operation to the frozen graph at run time', () => {
    let captured: Parameters<Parameters<typeof compose>[1]>[0] | undefined;
    const graph = compose('late-operation', builder => {
      captured = builder;
      const discovery = builder.collection('discovery');
      builder.fanout('contributor', {
        collection: discovery,
        template: member => [member.memo('summary', () => {
          captured?.callable('late');
          return null;
        })],
      });
    });
    const before = [...graph.topology];
    const report = runPass(graph, sourcesFor(baseData()).sources, new MemoryHistory(), {});
    expect(report.members['c-1']?.summary).toMatchObject({ status: 'failed', diagnostic: expect.stringMatching(/frozen/u) });
    expect(graph.topology).toEqual(before);
  });

  test('an unsupplied or doubly supplied slot fails admission before its caller body runs', () => {
    for (const assessor of ['missing', 'ambiguous'] as const) {
      paid.length = 0;
      const { report } = pass({ assessor }, baseData(), new MemoryHistory());
      expect(report.members['c-1']?.summary).toMatchObject({
        status: 'failed',
        decision: assessor === 'missing' ? 'missing-binding' : 'ambiguous-binding',
      });
      expect(paid).toEqual([]);
    }
  });
});

describe('keyed collections (candidate 3; A-07, COL-1)', () => {
  test('duplicate keys fail before member work with a diagnostic naming collection, key and custom key', () => {
    const data = baseData();
    data.contributors.push({ ...dave, id: 'c-1' });
    const { report } = pass({}, data, new MemoryHistory());
    expect(report.collection).toMatchObject({ status: 'rejected' });
    const diagnostic = report.collection.status === 'rejected' ? report.collection.diagnostic : '';
    expect(diagnostic).toMatch(/discovery/u);
    expect(diagnostic).toMatch(/c-1/u);
    expect(diagnostic).toMatch(/custom key/u);
    expect(report.members).toEqual({});
    expect(report.folds.report).toMatchObject({ status: 'failed' });
    expect(paid).toEqual([]);
    expect(gateEvaluations).toEqual([]);
  });

  test('a member without the designated identity fails before member work', () => {
    const data = baseData();
    const { id: _removed, ...anonymous } = dave;
    const graph = buildGraph().graph;
    const { sources } = sourcesFor(data);
    const collections = { discovery: () => ({ status: 'complete' as const, members: [...data.contributors, anonymous] }) };
    const report = runPass(graph, { ...sources, collections }, new MemoryHistory(), {});
    expect(report.collection).toMatchObject({ status: 'rejected', diagnostic: expect.stringMatching(/custom key/u) });
    expect(paid).toEqual([]);
  });

  test('member keys naming Object.prototype members are ordinary keys, never inherited state', () => {
    const data = baseData();
    data.contributors = [{ ...dave, id: '__proto__' }, { ...erin, id: 'constructor' }];
    const { report } = pass({}, data, new MemoryHistory());
    expect(report.collection).toEqual({ status: 'complete', keys: ['__proto__', 'constructor'] });
    expect(Object.getOwnPropertyDescriptor(report.members, '__proto__')?.value).toMatchObject({ summary: { status: 'succeeded' } });
    // An empty supervision object must not make `constructor` look pending through inheritance.
    expect(report.members.constructor).toMatchObject({ summary: { status: 'succeeded' } });
  });

  test('a custom key replaces the designated identity as the member key', () => {
    const { report } = pass({ customKey: true }, baseData(), new MemoryHistory());
    expect(report.collection).toEqual({ status: 'complete', keys: ['alice', 'bob', 'carol'] });
  });
});

describe('tracked gates and strict fold (candidates 4 and 5; A-08, A-11, RUN-005, RUN-010)', () => {
  test('changing a tracked gate changes instances but not topology', () => {
    const history = new MemoryHistory();
    const first = pass({}, baseData(), history).report;
    const data = baseData();
    data.config.minActivity = 4;
    const second = pass({}, data, history).report;
    expect(first.members['c-3']?.summary).toMatchObject({ status: 'succeeded' });
    expect(second.members['c-3']?.summary).toEqual({ status: 'skipped' });
    expect(buildGraph().graph.topology).toEqual(buildGraph().graph.topology);
  });

  test('skipped, undefined success, pending, failed and cancelled remain distinct', () => {
    const data = baseData();
    data.contributors.push(dave, erin, { id: 'c-6', login: 'fay', bio: 'x', activity: 9, prs: [] });
    data.pulls['pr-6'] = { size: -1, title: 'broken' };
    const { report } = pass({ summary: summaryOptional }, data, new MemoryHistory(), { 'c-3': 'pending', 'c-5': 'cancelled' });
    expect(report.members['c-1']?.summary).toMatchObject({ status: 'succeeded', value: { total: 4 } });
    expect(report.members['c-2']?.summary).toEqual({ status: 'skipped' });
    expect(report.members['c-3']?.summary).toEqual({ status: 'pending' });
    expect(report.members['c-4']?.summary).toMatchObject({ status: 'failed', diagnostic: expect.stringMatching(/pr-6/u) });
    expect(report.members['c-5']?.summary).toEqual({ status: 'cancelled' });
    const fay = report.members['c-6']?.summary;
    expect(fay).toMatchObject({ status: 'succeeded' });
    expect(fay !== undefined && 'value' in fay && fay.value === undefined).toBe(true);
  });

  test('A-11: with failed, pending and successful members and open discovery, siblings complete and the fold fails with keys', () => {
    const data = baseData();
    data.status = 'open';
    data.contributors.push(dave, erin);
    data.pulls['pr-6'] = { size: -1, title: 'broken' };
    const { report } = pass({}, data, new MemoryHistory(), { 'c-3': 'pending', 'c-5': 'cancelled' });
    expect(report.members['c-1']?.summary).toMatchObject({ status: 'succeeded' });
    expect(report.folds.report).toMatchObject({
      status: 'failed', failed: ['c-4'], cancelled: ['c-5'], pending: ['c-3'], openDiscovery: true,
    });
    expect(paid).not.toContain('report');
  });

  test('RUN-005: ready members publish while discovery is open and the strict fold stays unstarted', () => {
    const data = baseData();
    data.status = 'open';
    const { report } = pass({}, data, new MemoryHistory());
    expect(report.members['c-1']?.summary).toMatchObject({ status: 'succeeded', reference: 'result-3' });
    expect(report.folds.report).toEqual({ status: 'waiting', openDiscovery: true, pending: [] });
    expect(paid).not.toContain('report');
  });

  test('a pending member alone leaves the strict fold waiting, never failed or partial', () => {
    const { report } = pass({}, baseData(), new MemoryHistory(), { 'c-3': 'pending' });
    expect(report.folds.report).toEqual({ status: 'waiting', openDiscovery: false, pending: ['c-3'] });
  });

  test('a closed empty population is a successful fold; an open empty one waits', () => {
    const closed = baseData();
    closed.contributors = [];
    const done = pass({}, closed, new MemoryHistory()).report;
    expect(done.folds.report).toMatchObject({ status: 'succeeded', value: { total: 0, included: [], skipped: [] } });
    const open = baseData();
    open.contributors = [];
    open.status = 'open';
    expect(pass({}, open, new MemoryHistory()).report.folds.report).toEqual({ status: 'waiting', openDiscovery: true, pending: [] });
  });

  test('the strict fold receives explicit skipped entries whose data cannot be read', () => {
    const history = new MemoryHistory();
    const { report } = pass({}, baseData(), history);
    expect(report.folds.report).toMatchObject({ status: 'succeeded', value: { total: 5, included: ['c-1', 'c-3'], skipped: ['c-2'] } });
    const greedy = pass({ fold: greedyReport }, baseData(), new MemoryHistory()).report;
    expect(greedy.folds.report).toMatchObject({ status: 'failed', diagnostic: expect.stringMatching(/skipped/u) });
  });

  test('a gate over absent evidence or with a non-boolean result fails the member instead of skipping it', () => {
    const data = baseData();
    const { activity: _absent, ...withoutActivity } = dave;
    const graph = buildGraph().graph;
    const { sources } = sourcesFor(data);
    const collections = { discovery: () => ({ status: 'complete' as const, members: [...data.contributors, withoutActivity] }) };
    const absent = runPass(graph, { ...sources, collections }, new MemoryHistory(), {});
    expect(absent.members['c-4']?.summary).toMatchObject({ status: 'failed' });
    expect(absent.folds.report).toMatchObject({ status: 'failed', failed: ['c-4'] });
    expect(paid).not.toContain('summary:c-4');
    paid.length = 0;
    const truthy = pass({ untypedGate: truthyGate }, baseData(), new MemoryHistory()).report;
    expect(truthy.members['c-1']?.summary).toMatchObject({ status: 'failed', diagnostic: expect.stringMatching(/boolean/u) });
    expect(paid.filter(entry => entry.startsWith('summary:'))).toEqual([]);
  });

  test('gate evidence participates through outcomes: a threshold change without a flip reruns nothing', () => {
    const history = new MemoryHistory();
    pass({}, baseData(), history);
    paid.length = 0;
    const data = baseData();
    data.config.minActivity = 3;
    const { report } = pass({}, data, history);
    expect(paid).toEqual([]);
    expect(report.folds.report).toMatchObject({ status: 'succeeded', decision: 'hit', reference: 'result-6' });
  });

  test('RUN-010: repairing a failed member reruns it and the fold; unaffected members stay unexecuted', () => {
    const history = new MemoryHistory();
    const broken = baseData();
    broken.contributors.push(dave);
    broken.pulls['pr-6'] = { size: -1, title: 'broken' };
    expect(pass({}, broken, history).report.folds.report).toMatchObject({ status: 'failed', failed: ['c-4'] });
    paid.length = 0;
    const repaired = baseData();
    repaired.contributors.push(dave);
    const { report } = pass({}, repaired, history);
    expect([...paid].sort()).toEqual(['assess:pr-6', 'report', 'summary:c-4']);
    expect(report.folds.report).toMatchObject({ status: 'succeeded', value: { total: 6, included: ['c-1', 'c-3', 'c-4'], skipped: ['c-2'] } });
  });
});

/**
 * Preserved counterexamples (EXP-0). Each asserts the *observed unsafe* result,
 * as EXP-1 does, so a later mechanism that closes the hole must update the
 * test deliberately. Both are outside the tracked-influence contract (CMP-9).
 */
describe('preserved counterexamples', () => {
  test('counterexample (candidate 1): a derived argument taken from untracked closure state is falsely justified', () => {
    let untrackedPr = 'pr-1';
    const summary = (context: IContext): IData => {
      paid.push('closure-summary');
      context.read(['member', 'login']);
      return { total: context.call('assessor', untrackedPr, forward(['input', 'pulls'])).read(['score']) };
    };
    const history = new MemoryHistory();
    expect(pass({ summary }, baseData(), history).report.members['c-1']?.summary).toMatchObject({ value: { total: 3 } });
    // A fresh execution would now assess pr-2 (score 1). Own evidence and the recorded
    // prefix are unchanged, so the recorded derived value is accepted: a false hit.
    untrackedPr = 'pr-2';
    paid.length = 0;
    const second = pass({ summary }, baseData(), history).report;
    expect(second.members['c-1']?.summary).toMatchObject({ decision: 'hit', value: { total: 3 } });
    expect(paid).toEqual([]);
  });

  test('counterexample (candidate 2): equal emitted text over different captured configuration hides a supplied-slot swap', () => {
    const makeAssessor = (threshold: number) => (context: IContext): IData => {
      const prId = context.read(['argument', 0]);
      const size = context.read(['argument', 1, String(prId), 'size']);
      return { score: typeof size === 'number' && size > threshold ? 3 : 1 };
    };
    const history = new MemoryHistory();
    pass({ supplied: makeAssessor(100) }, baseData(), history);
    paid.length = 0;
    // With threshold 50, pr-4 (size 80) should score 3; the identical closure text reuses score 1.
    const second = pass({ supplied: makeAssessor(50) }, baseData(), history).report;
    expect(second.members['c-3']?.summary).toMatchObject({ decision: 'hit', value: { total: 1 } });
    expect(paid).toEqual([]);
  });
});
