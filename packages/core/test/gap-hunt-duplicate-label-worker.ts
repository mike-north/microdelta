/** RES-001: display metadata may collide while opaque memo subjects remain independent. */
import { authoring, openWorkspace } from 'microdelta';
interface IHelpers { readonly trace: (subject: string) => void }
type IInputs = Record<never, never>;
const [location, phase, mode] = process.argv.slice(2);
if (location === undefined || phase === undefined || mode === undefined) { throw new Error('Expected location, phase and mode'); }
const builders = authoring<IInputs, IHelpers>();
/** A stable helper measures actual paid-body entry without changing implementation across restart. */
function trace(subject: string): void { process.stderr.write(`BODY:${subject}\n`); }
const first = builders.memo({ subject: 'subject:first', label: mode === 'duplicate' ? 'shared display' : 'first display', run: ({ helpers }) => { helpers.trace('first'); return { score: 11 }; } });
const second = builders.memo({ subject: 'subject:second', label: mode === 'duplicate' ? 'shared display' : 'second display', run: ({ helpers }) => { helpers.trace('second'); return { score: 29 }; } });
const steps = [{ slot: 'first', declaration: first }, { slot: 'second', declaration: second }];
const composition = builders.compose({ scope: 'duplicate-labels', steps: phase === 'restart' ? [...steps].reverse() : steps, helpers: [{ slot: 'trace', helper: trace }] });
const workspace = openWorkspace({ location, logicalStore: 'duplicate-labels-store' });
try {
  const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async run => {
    const reports = [];
    for (const slot of ['first', 'second']) {
      const outcome = await run.resolve({ scope: 'duplicate-labels', role: 'step', slot }, { requestKey: `${phase}:${slot}` });
      if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`Unexpected ${outcome.kind}`); }
      reports.push({ slot, kind: outcome.kind, reference: outcome.reference.locator, data: run.read<{ readonly score: number }>(outcome.reference) });
    }
    return reports;
  });
  process.stdout.write(`${JSON.stringify(result.value)}\n`);
} finally { workspace.close(); }
