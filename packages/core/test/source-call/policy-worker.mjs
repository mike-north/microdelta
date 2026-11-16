/** Untyped caller exercises the dynamic source's runtime outcome and argument boundaries. */
import { authoring, openWorkspace } from 'microdelta';
const [location, mode, valueText, earlierText] = process.argv.slice(2);
if (location === undefined || mode === undefined || valueText === undefined) { throw new Error('Missing source policy worker job'); }
const value = Number(valueText);
const earlier = earlierText === undefined ? undefined : JSON.parse(earlierText);
const scope = 'source-call:runtime-policy';
const api = authoring();
const slot = api.sourceSlot({ slot: 'detail' });
const observed = { calls: 0, hooks: 0, previous: [], phases: [] };
const source = api.suppliedSource({
  finality: ({ args, previous }) => { observed.hooks += 1; return args[0] === 'never' && previous.data.value === -1; },
  run: async ({ args, inputs, previous, outcome }) => {
    observed.calls += 1;
    observed.previous.push(previous !== undefined);
    await Promise.resolve();
    const id = args[0];
    const current = inputs.config.value;
    if (mode === 'forged') { return { kind: 'fresh', data: { value: current } }; }
    if (mode === 'retain') { return outcome.retain(previous); }
    if (mode === 'borrowed-carrier') { return outcome.retain(Object.freeze({ data: previous?.data })); }
    if (mode === 'argument-output') { return outcome.fresh(args); }
    return outcome.fresh({ value: current, id });
  },
});
const summary = api.memo({ subject: 'summary', children: { detail: slot }, run: async ({ calls, inputs }) => {
  const selected = await calls.detail(mode === 'raw-view' ? inputs.config : 'repo#101');
  return { value: selected.data.value };
} });
const composition = api.compose({ scope, inputs: [{ slot: 'config', value: { value } }], steps: [{ slot: 'summary', declaration: summary }], supplied: [api.supplySource({ slot, declaration: source, subject: ([id]) => `detail:${String(id)}` })] });
const workspace = openWorkspace({ location, logicalStore: scope });
try {
  const result = await workspace.run({ authoring: api, composition, environment: 'production', observers: [{ observe(event) { if (event.kind === 'step' && event.event.step.slot === 'detail') { observed.phases.push(event.event.phase); } } }] }, async run => {
    try {
      const settled = await run.resolve({ scope, role: 'step', slot: 'summary' }, { requestKey: `policy:${process.pid}` });
      if (settled.kind !== 'published' && settled.kind !== 'reused') { throw new Error('Expected a result'); }
      return { status: 'succeeded', reference: settled.reference, historical: earlier === undefined ? undefined : run.read(earlier), codes: [] };
    } catch (error) {
      const codes = [];
      for (let cause = error; typeof cause === 'object' && cause !== null; cause = cause.cause) { if (typeof cause.code === 'string') { codes.push(cause.code); } }
      return { status: 'failed', codes, historical: earlier === undefined ? undefined : run.read(earlier) };
    }
  });
  process.stdout.write(`${JSON.stringify({ ...result.value, ...observed })}\n`);
} finally { workspace.close(); }
