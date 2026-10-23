/** Deterministic supported-value fixtures survive only as snapshots between independent workers. */
import { authoring, openWorkspace } from '../src/index.js';

/** A finite fixture domain keeps special spellings and JavaScript number atoms explicit. */
interface IConfig {
  readonly key: string;
  readonly record: { readonly [key: string]: string | number | undefined };
  readonly rows: readonly (string | undefined)[];
  readonly numeric: number;
}
interface IInputs { readonly config: IConfig }
type IHelpers = Record<never, never>;

/** Own data properties deliberately avoid object-literal __proto__ syntax changing the prototype. */
function recordOf(key: string, value: string | number | undefined, inherited = false): IConfig['record'] {
  const record: { [key: string]: string | number | undefined } = {};
  if (inherited) {
    const prototype: { [key: string]: string | number | undefined } = {};
    Object.setPrototypeOf(prototype, null);
    Object.defineProperty(prototype, key, { value, enumerable: true, configurable: true, writable: true });
    Object.setPrototypeOf(record, prototype);
  } else { Object.defineProperty(record, key, { value, enumerable: true, configurable: true, writable: true }); }
  return record;
}

/** No PRNG or JSON coercion chooses the domain: each command names one known supported value. */
function configOf(key: string, variant: string): IConfig {
  const base: IConfig = { key, record: recordOf(key, 'Ada'), rows: ['Ada', 'Ben'], numeric: 0 };
  switch (variant) {
    case 'base': return base;
    case 'leaf-change': return { ...base, record: recordOf(key, 'Grace') };
    case 'present-undefined': return { ...base, record: recordOf(key, undefined) };
    case 'missing': {
      const empty: IConfig['record'] = {};
      Object.setPrototypeOf(empty, null);
      return { ...base, record: empty };
    }
    case 'inherited-same': return { ...base, record: recordOf(key, 'Ada', true) };
    case 'inherited-change': return { ...base, record: recordOf(key, 'Grace', true) };
    case 'unread-change': return { ...base, record: { ...base.record, unread: 'changed' } };
    case 'rows-hole': return { ...base, rows: new Array<string | undefined>(2) };
    case 'rows-undefined': return { ...base, rows: [undefined, undefined] };
    case 'rows-fill': return { ...base, rows: ['Grace', undefined] };
    case 'negative-zero': return { ...base, numeric: -0 };
    case 'nan': return { ...base, numeric: Number.NaN };
    case 'infinity': return { ...base, numeric: Number.POSITIVE_INFINITY };
    case 'negative-infinity': return { ...base, numeric: Number.NEGATIVE_INFINITY };
    default: throw new Error('Unknown finite fixture');
  }
}

async function main(): Promise<void> {
  const [location, keyWire, variant, slot, requestKey] = process.argv.slice(2);
  if (location === undefined || keyWire === undefined || variant === undefined || slot === undefined || requestKey === undefined) { throw new Error('Expected location, key, snapshot, operation, request'); }
  const key = Buffer.from(keyWire, 'base64').toString('utf16le');
  const builders = authoring<IInputs, IHelpers>();
  const leaf = builders.memo({ subject: 'edge-leaf', run: ({ inputs }) => ({ selected: inputs.config.record[inputs.config.key] }) });
  const membership = builders.memo({ subject: 'edge-membership', run: ({ inputs }) => ({ selected: inputs.config.key in inputs.config.record }) });
  const condition = builders.memo({ subject: 'edge-condition', run: ({ inputs }) => ({ selected: inputs.config.record[inputs.config.key] === undefined ? 'undefined' : 'defined' }) });
  const position = builders.memo({ subject: 'edge-position', run: ({ inputs }) => ({ selected: inputs.config.rows[0] }) });
  const arrayMembership = builders.memo({ subject: 'edge-array-membership', run: ({ inputs }) => ({ selected: 0 in inputs.config.rows }) });
  const number = builders.memo({ subject: 'edge-number', run: ({ inputs }) => ({ selected: Object.is(inputs.config.numeric, -0) ? '-0' : Number.isNaN(inputs.config.numeric) ? 'NaN' : inputs.config.numeric === Infinity ? '+Infinity' : inputs.config.numeric === -Infinity ? '-Infinity' : 'zero' }) });
  const composition = builders.compose({ scope: 'edge-analysis', inputs: [{ slot: 'config', value: configOf(key, variant) }], helpers: [], steps: [
    { slot: 'leaf', declaration: leaf }, { slot: 'membership', declaration: membership }, { slot: 'condition', declaration: condition },
    { slot: 'position', declaration: position }, { slot: 'arrayMembership', declaration: arrayMembership }, { slot: 'number', declaration: number },
  ] });
  const workspace = openWorkspace({ location, logicalStore: 'edge-store' });
  try {
    const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async (run) => {
      const outcome = await run.resolve({ scope: 'edge-analysis', role: 'step', slot }, { requestKey });
      if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`Unexpected ${outcome.kind}`); }
      return { kind: outcome.kind, reference: outcome.reference, value: run.read<unknown>(outcome.reference) };
    });
    process.stdout.write(`${JSON.stringify(result.value)}\n`);
  } finally { workspace.close(); }
}
await main();
