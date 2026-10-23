/**
 * The experimental numeric boundary composes the existing workspace runtime.
 * Author numbers cross a visible internal record-root carrier; owners retain
 * publication, observation, validation and admission decisions.
 */
import { authoring } from 'microdelta';
import type { IRunObserver, ITrackedHelpers, IWorkspace } from 'microdelta';
import type { IAnyMemoDeclaration, ICalls } from '@microdelta/definition';
import type { IResolutionFamily } from '@microdelta/resolution';
import type { ITrackedView } from '@microdelta/tracking';
import { graphOf } from './protocol.js';
import type { IAnalysis, IEdge } from './protocol.js';

/** Explicit execution scope and current application snapshots, separate from symbolic construction. @internal */
export interface IExecuteOptions<TInputs extends object> {
  readonly analysis: string;
  readonly environment: string;
  readonly requestKey: string;
  readonly inputs: NoInfer<TInputs>;
  readonly observers?: readonly IRunObserver[];
}
/** Exact reference and current primitive value remain distinct outcomes. @internal */
export interface IResult {
  readonly kind: 'published' | 'reused';
  readonly data: number;
  readonly reference: { readonly kind: 'completed-result'; readonly locator: string };
}
/** The runtime keeps its supported record root; this carrier is never authored by the example. */
interface IStoredNumber { readonly value: number }
/** Current structural recipe metadata is data evidence, not a closure remembered from an old run. */
interface IRecipe { readonly helperSlot: string; readonly edges: readonly IEdge[] }
/** Application snapshots and current recipes use distinct declared input slots. */
interface IMachineInputs { readonly data: Readonly<Record<string, unknown>>; readonly recipes: Readonly<Record<string, IRecipe>> }
/** The owner family is unchanged; the experiment only composes its generated declaration surface. */
type IFamily = IResolutionFamily<IMachineInputs, IHelpers>;
/** Only already-declared numeric sibling nodes can be called in this bounded graph. */
type IChildren = Readonly<Record<string, IAnyMemoDeclaration<IFamily>>>;
/**
 * Private callback capabilities keep actual authored function identities intact.
 * The dispatcher is framework plumbing, never an authored helper feature.
 */
interface IHelpers {
  readonly dispatch: typeof dispatch;
  readonly [slot: string]: (...arguments_: never[]) => unknown;
}

/**
 * Resolve only explicit current origins, then invoke the exact tracked authored
 * function. No input subtree is detached: object arguments remain selected
 * views, and a child number is read at `data.value` inside its parent's capture.
 */
async function dispatch(
  recipe: ITrackedView<IRecipe> | undefined,
  inputs: ITrackedView<Readonly<Record<string, unknown>>>,
  calls: ICalls<IFamily, IChildren>,
  helpers: ITrackedHelpers<IHelpers>,
): Promise<IStoredNumber> {
  if (recipe === undefined) { throw new Error('Missing current symbolic recipe'); }
  const values: Record<string, unknown> = {};
  for (let position = 0; position < recipe.edges.length; position += 1) {
    const edge = recipe.edges[position];
    if (edge === undefined) { throw new Error('Missing current symbolic edge'); }
    if (edge.kind === 'input') {
      Object.defineProperty(values, edge.key, { enumerable: true, get: () => inputs[edge.slot] });
    } else {
      const call = calls[edge.slot];
      if (call === undefined) { throw new Error(`Undeclared symbolic child ${edge.slot}`); }
      const child = await call();
      // Resolve declared children before the synchronous callback, but observe
      // their numeric output only if the author selects this argument.
      Object.defineProperty(values, edge.key, { enumerable: true, get: () => {
        const data = child.data;
        if (data === null || typeof data !== 'object' || !('value' in data)) { throw new TypeError('Expected internal numeric child carrier'); }
        const value: unknown = Reflect.get(data, 'value');
        if (typeof value !== 'number') { throw new TypeError('Expected numeric child output'); }
        return value;
      } });
    }
  }
  const authored = helpers[recipe.helperSlot];
  if (authored === undefined) { throw new Error('Missing current authored callback capability'); }
  // Dynamic invocation erases only the record's compile-time field names. Each
  // field came from an owned current origin, and the returned number is checked
  // before publication. The actual function, not a wrapper/bind substitute,
  // is the tracked capability invoked here.
  const result: unknown = Reflect.apply(authored, undefined, [Object.freeze(values)]);
  if (typeof result !== 'number') { throw new TypeError('The prototype accepts only synchronous numeric results, never thenables or storage wrappers'); }
  return Object.freeze({ value: result });
}

/** Copy only the application's top-level own data bindings; nested values remain unconsumed snapshots. */
function inputData(inputs: object): Readonly<Record<string, unknown>> {
  const data: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(inputs)) {
    const descriptor = Object.getOwnPropertyDescriptor(inputs, key);
    if (descriptor === undefined || !('value' in descriptor)) { throw new TypeError(`Expected own data input ${key}`); }
    const value: unknown = descriptor.value;
    Object.defineProperty(data, key, { enumerable: true, value });
  }
  return Object.freeze(data);
}

/** Run one fixed entry through ordinary workspace supervision. @internal */
export async function execute<TInputs extends object>(workspace: IWorkspace, entry: IAnalysis<TInputs>, options: IExecuteOptions<TInputs>): Promise<IResult> {
  const graph = graphOf(entry);
  const data = inputData(options.inputs);
  const builders = authoring<IMachineInputs, IHelpers>();
  const declarations = new Map<string, IAnyMemoDeclaration<IFamily>>();
  const recipes: Record<string, IRecipe> = {};
  const callbacks: { readonly slot: string; readonly helper: (...arguments_: never[]) => unknown }[] = [{ slot: 'dispatch', helper: dispatch }];
  for (const node of graph.nodes) {
    const children: Record<string, IAnyMemoDeclaration<IFamily>> = {};
    for (const edge of node.edges) {
      if (edge.kind === 'input') {
        if (!Object.hasOwn(data, edge.slot)) { throw new TypeError(`Missing declared input origin ${edge.slot}`); }
      } else {
        const child = declarations.get(edge.slot);
        if (child === undefined) { throw new TypeError(`Missing declared memo origin ${edge.slot}`); }
        if (!Object.hasOwn(children, edge.slot)) { Object.defineProperty(children, edge.slot, { enumerable: true, value: child }); }
      }
    }
    const occurrence = node.name;
    const helperSlot = `authoring:run:${occurrence}`;
    Object.defineProperty(recipes, occurrence, { enumerable: true, value: Object.freeze({ helperSlot, edges: node.edges }) });
    callbacks.push({ slot: helperSlot, helper: node.run });
    declarations.set(occurrence, builders.memo({ subject: node.subject, children, run: ({ inputs, helpers, calls }) => {
      // eslint-disable-next-line microdelta/tracked-captures -- Framework occurrence correspondence is frozen by graph construction and Definition's explicit slot; every semantic edge and callback slot is read from this current tracked recipe, never from an untracked captured plan.
      const recipe = inputs.recipes[occurrence];
      return helpers.dispatch(recipe, inputs.data, calls, helpers);
    } }));
  }
  const composition = builders.compose({ scope: options.analysis,
    inputs: [{ slot: 'data', value: data }, { slot: 'recipes', value: Object.freeze(recipes) }], helpers: callbacks,
    steps: [...declarations].map(([slot, declaration]) => ({ slot, declaration })) });
  const finished = await workspace.run({ authoring: builders, composition, environment: options.environment,
    ...(options.observers === undefined ? {} : { observers: options.observers }) }, async (run) => {
    const outcome = await run.resolve({ scope: options.analysis, role: 'step', slot: graph.entry }, { requestKey: options.requestKey });
    if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`Prototype resolution did not produce a value: ${outcome.kind}`); }
    const stored = run.read<unknown>(outcome.reference);
    if (stored === null || typeof stored !== 'object' || !('value' in stored) || typeof stored.value !== 'number') { throw new TypeError('Expected internal numeric result carrier'); }
    const result: IResult = { kind: outcome.kind, data: stored.value, reference: outcome.reference };
    return Object.freeze(result);
  });
  return finished.value;
}
