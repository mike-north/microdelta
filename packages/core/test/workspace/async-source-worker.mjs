/**
 * One independent process exercising the facade's direct or template source.
 * Only SQLite history crosses process boundaries; callback controls are rebuilt.
 */
import { authoring, openWorkspace } from 'microdelta';

const [location, target, mode, inputText, earlierText] = process.argv.slice(2);
if (location === undefined || target === undefined || mode === undefined || inputText === undefined) {
  throw new Error('An async source worker needs a store, target, policy and input.');
}

/** The declared input whose read after an await must become source evidence. */
const value = Number(inputText);
/** The exact historical reference requested by the parent, if any. */
const earlier = earlierText === undefined ? undefined : JSON.parse(earlierText);
/** Callback execution count, separate from any published or accepted result. */
let calls = 0;
/** The fixed scope keeps exact references comparable between these processes. */
const scope = 'async-source-contract';
const api = authoring();

/** One source callback shape shared by direct and member-scoped declarations. */
async function check({ outcome, previous, inputs, member }) {
  calls += 1;
  await Promise.resolve();
  const selected = inputs.config.value;
  if (member !== undefined && member.key !== 'one') {
    throw new Error('unexpected member binding');
  }
  if (mode === 'throw') {
    throw new Error('source rejected after await');
  }
  if (mode === 'forged') {
    return { kind: 'fresh', data: { value: selected } };
  }
  if (mode === 'retain-missing' || mode === 'retain') {
    return outcome.retain(previous);
  }
  return outcome.fresh({ value: selected });
}

/** The collection only supplies the member's identity; its policy stays ordinary. */
const listing = api.source({
  subject: 'listing', collection: { identity: 'key' },
  run: ({ outcome }) => outcome.fresh({ status: 'complete', members: [{ key: 'one' }] }),
});
const direct = api.source({ subject: 'direct', run: check });
const template = api.template({ slot: 'member', collection: listing, steps: (member) => ({
  value: member.source({ subject: member.subject('value'), run: check }),
}) });
const composition = api.compose({
  scope,
  inputs: [{ slot: 'config', value: { value } }],
  steps: [{ slot: 'direct', declaration: direct }, { slot: 'listing', declaration: listing }],
  templates: [template],
});
const step = target === 'template'
  ? { scope, role: 'step', slot: 'value', collection: 'listing', template: 'member', memberKey: 'one' }
  : { scope, role: 'step', slot: 'direct' };
const workspace = openWorkspace({ location, logicalStore: scope });
const phases = [];
try {
  const result = await workspace.run({
    authoring: api,
    composition,
    environment: 'fixture',
    observers: [{ observe(event) {
      if (event.kind === 'step' && event.event.step.slot === step.slot) {
        phases.push(event.event.phase);
      }
    } }],
  }, async (run) => {
    try {
      const settled = await run.resolve(step, { requestKey: `async:${process.pid}` });
      const historical = earlier === undefined ? undefined : run.read(earlier);
      return { kind: 'returned', settled, historical };
    } catch (error) {
      const historical = earlier === undefined ? undefined : run.read(earlier);
      return { kind: 'failed', code: error?.code, historical };
    }
  });
  console.log(JSON.stringify({ ...result.value, calls, phases }));
} finally {
  workspace.close();
}
