/**
 * One fresh process measures literal read precision through facade declarations.
 * Each invocation opens the same durable Store and reports actual reader-body
 * executions and the exact completed reference; no process-local cache survives.
 */
import { authoring, openWorkspace } from 'microdelta';

/** The optional field's ownership varies independently of its value and siblings. */
interface IConfig {
  readonly rows: readonly number[];
  readonly optional?: number | undefined;
  readonly factor: number;
  readonly unread: string;
}
/** A helper factory reads only this structural view; it need not receive array capabilities. */
interface IFactor { readonly factor: number }
/** The workspace exposes configuration through one Tracking-owned input slot. */
interface IInputs { readonly config: IConfig }
/** Helpers supply a test counter and a closure that observes its passed tracked view. */
interface IHelpers {
  readonly trace: () => void;
  readonly make: (configuration: IFactor) => () => number;
}
/** A retained child result preserves missing versus own undefined without unrelated fields. */
interface IOptional { readonly optional?: number | undefined }

/** Close over the runtime's tracked argument view, without extracting a scalar first. */
function make(configuration: IFactor): () => number { return () => configuration.factor * 3; }
/** A test counter, never an invalidating influence. */
function trace(): void { process.stderr.write('BODY:reader\n'); }

/** Variants alter exactly the intended consumption boundary. */
function configOf(variant: string): IConfig {
  const base: IConfig = { rows: [10, 20, 30], factor: 2, unread: 'base' };
  switch (variant) {
    case 'base': return base;
    case 'same-length': return { ...base, rows: [99, 88, 77] };
    case 'after-position': return { ...base, rows: [10, 20, 99] };
    case 'append': return { ...base, rows: [10, 20, 30, 40] };
    case 'insert-before': return { ...base, rows: [5, 10, 20, 30] };
    case 'own-undefined': return { ...base, optional: undefined };
    case 'optional-value': return { ...base, optional: 7 };
    case 'owned-sibling': return { ...base, optional: 7, unread: 'changed' };
    case 'unread': return { ...base, unread: 'changed' };
    case 'factor': return { ...base, factor: 3 };
    case 'inherited': {
      // A supported custom prototype supplies membership, never own presence.
      const inherited: unknown = Object.create({ optional: undefined });
      if (inherited === null || typeof inherited !== 'object') {
        throw new Error('The inherited fixture must be an object');
      }
      return Object.assign(inherited, base);
    }
    default: throw new Error(`Unknown variant ${variant}`);
  }
}

/** Independent process arguments select one declared reader and current input. */
const [location, mode, variant, requestKey] = process.argv.slice(2);
if (location === undefined || mode === undefined || variant === undefined || requestKey === undefined) {
  throw new Error('Expected store, mode, variant and request key');
}
/** Every tested reader is declared through the generated facade authoring contract. */
const builders = authoring<IInputs, IHelpers>();
/** Length observes cardinality without observing every element. */
const length = builders.memo({ subject: 'length', run: ({ inputs, helpers }) => {
  helpers.trace();
  return { selected: inputs.config.rows.length };
} });
/** A positional read observes only the selected index, not stable entity identity. */
const position = builders.memo({ subject: 'position', run: ({ inputs, helpers }) => {
  helpers.trace();
  return { selected: inputs.config.rows[1] };
} });
/** Missing and own undefined return the same value to this reader. */
const value = builders.memo({ subject: 'value', run: ({ inputs, helpers }) => {
  helpers.trace();
  return { selected: inputs.config.optional === undefined ? 'undefined' : inputs.config.optional };
} });
/** Own presence consumes no field payload or inherited membership. */
const own = builders.memo({ subject: 'own', run: ({ inputs, helpers, hasOwn }) => {
  helpers.trace();
  return { selected: hasOwn(inputs.config, 'optional') };
} });
/** Ordinary membership remains a separate operation that includes supported prototypes. */
const membership = builders.memo({ subject: 'membership', run: ({ inputs, helpers }) => {
  helpers.trace();
  return { selected: 'optional' in inputs.config };
} });
/** The source carries the optional field into retained History without fabricating its presence. */
const optional = builders.source<IOptional>({ subject: 'optional', run: ({ inputs, hasOwn, outcome }) => {
  return outcome.fresh(hasOwn(inputs.config, 'optional') ? { optional: inputs.config.optional } : {});
} });
/** The same capability accepts the owning observer's lazy retained child view. */
const lazyOwn = builders.memo({ subject: 'lazy-own', children: { optional }, run: async ({ calls, helpers, hasOwn }) => {
  helpers.trace();
  const child = await calls.optional();
  return { selected: hasOwn(child.data, 'optional') };
} });
/** A returned helper closure reads the passed tracked view while the author capture remains active. */
const closure = builders.memo({ subject: 'closure', run: ({ inputs, helpers }) => {
  helpers.trace();
  const calculate = helpers.make(inputs.config);
  return { selected: calculate() };
} });
/** Stable declarations are reconnected to each process's fresh current configuration. */
const composition = builders.compose({
  scope: 'durable-read-matrix',
  inputs: [{ slot: 'config', value: configOf(variant) }],
  helpers: [{ slot: 'trace', helper: trace }, { slot: 'make', helper: make }],
  steps: [
    { slot: 'length', declaration: length }, { slot: 'position', declaration: position },
    { slot: 'value', declaration: value }, { slot: 'own', declaration: own },
    { slot: 'membership', declaration: membership }, { slot: 'optional', declaration: optional },
    { slot: 'lazy-own', declaration: lazyOwn }, { slot: 'closure', declaration: closure },
  ],
});
/** A durable workspace is opened and completely closed in every worker process. */
const workspace = openWorkspace({ location, logicalStore: 'durable-read-matrix-store' });
try {
  const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async run => {
    const outcome = await run.resolve({ scope: 'durable-read-matrix', role: 'step', slot: mode }, { requestKey });
    if (outcome.kind !== 'published' && outcome.kind !== 'reused') {
      throw new Error(`Unexpected ${outcome.kind}`);
    }
    return { kind: outcome.kind, reference: outcome.reference.locator, data: run.read<unknown>(outcome.reference) };
  });
  // This probe reports emitted text only; it never supplies runtime evidence or values.
  process.stdout.write(`${JSON.stringify({ ...result.value, implementation: { factory: make.toString(), callable: make(configOf('base')).toString() } })}\n`);
} finally {
  workspace.close();
}
