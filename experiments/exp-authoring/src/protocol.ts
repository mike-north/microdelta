/**
 * Experimental fixed symbolic graphs. Tokens describe current composition
 * correspondence; they contain no runtime data, retained values or execution
 * authority. Only synchronous numeric computations belong to this first slice.
 * No symbol exported here is a microdelta public API.
 */
import type { ITrackedView } from '@microdelta/tracking';

/** A private nominal marker separates symbolic bindings from arbitrary data. */
const bindingBrand: unique symbol = Symbol('authoring:binding');
/** Type-only covariance records what a valid origin yields during execution. */
declare const bindingValue: unique symbol;
/** Analysis ownership is separate from a node's runtime data type. */
const analysisBrand: unique symbol = Symbol('authoring:analysis');
/** Type-only input evidence anchors application input inference. */
declare const analysisInputs: unique symbol;

/** An owned symbolic input or numeric memo output, never its runtime value. @internal */
export interface IBinding<T> { readonly [bindingBrand]: true; readonly [bindingValue]?: T }
/** A frozen entry graph with an ordinary application input type. @internal */
export interface IAnalysis<TInputs extends object> { readonly [analysisBrand]: true; readonly [analysisInputs]?: TInputs }
/** Only explicit application input keys can create input origins. @internal */
export type IInput<TInputs extends object> = <K extends keyof TInputs & string>(slot: K) => IBinding<TInputs[K]>;
/** Named owned origins declare graph relationships once. @internal */
export type IFrom = Readonly<Record<string, IBinding<unknown>>>;
/** Author callbacks receive selected tracked views, while numeric child results stay ordinary numbers. @internal */
export type IValues<TFrom extends IFrom> = { readonly [K in keyof TFrom]: TFrom[K] extends IBinding<infer TValue> ? ITrackedView<TValue> : never };
/** One bounded numeric computation and its complete author-supplied identity. @internal */
export interface IMemoOptions<TFrom extends IFrom> {
  readonly name: string;
  readonly subject?: string;
  readonly from: TFrom;
  readonly run: (values: IValues<TFrom>) => number;
}
/** A copied relationship keeps its author alias separate from its actual structural target. @internal */
export interface IEdge { readonly key: string; readonly kind: 'input' | 'memo'; readonly slot: string }
/** A node retains the exact authored callback, not a generated wrapper as its implementation. @internal */
export interface INode { readonly name: string; readonly subject: string; readonly edges: readonly IEdge[]; readonly run: (values: never) => number }
/** Internal graph data is frozen before execution can inspect it. @internal */
export interface IGraph { readonly entry: string; readonly nodes: readonly INode[] }

/** One graph's construction-only ownership, discarded when its topology freezes. */
interface IBuilder { readonly origins: WeakMap<object, Omit<IEdge, 'key'>>; readonly nodes: INode[] }
/** Synchronous construction has one explicit owner; no runtime evaluation consults this slot. */
let constructing: IBuilder | undefined;
/** Execution can inspect only graphs minted by this experiment. */
const graphs = new WeakMap<object, IGraph>();

/** Mint a nominal token whose runtime meaning stays in its construction owner's private table. */
function binding<T>(owner: IBuilder, origin: Omit<IEdge, 'key'>): IBinding<T> {
  const token: IBinding<T> = { [bindingBrand]: true };
  owner.origins.set(token, Object.freeze(origin));
  return Object.freeze(token);
}

/** Read an own data option without invoking a getter while discovering fixed topology. */
function dataField(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !('value' in descriptor)) { throw new TypeError(`Expected own data option ${key}`); }
  const value: unknown = descriptor.value;
  return value;
}

/** Build fixed relationships without running any authored computation. @internal */
export function analysis<TInputs extends object>(build: (input: IInput<TInputs>) => IBinding<number>): IAnalysis<TInputs> {
  if (constructing !== undefined) { throw new Error('Nested analysis construction is outside the bounded prototype'); }
  const owner: IBuilder = { origins: new WeakMap(), nodes: [] };
  constructing = owner;
  try {
    const entry = build(<K extends keyof TInputs & string>(slot: K): IBinding<TInputs[K]> => {
      if (typeof slot !== 'string' || slot.length === 0) { throw new TypeError('Expected an explicit input slot'); }
      return binding<TInputs[K]>(owner, { kind: 'input', slot });
    });
    const origin = typeof entry === 'object' && entry !== null ? owner.origins.get(entry) : undefined;
    if (origin?.kind !== 'memo') { throw new TypeError('The entry must be an owned numeric memo origin'); }
    const token: IAnalysis<TInputs> = { [analysisBrand]: true };
    graphs.set(token, Object.freeze({ entry: origin.slot, nodes: Object.freeze([...owner.nodes]) }));
    return Object.freeze(token);
  } finally { constructing = undefined; }
}

/** Declare one synchronous numeric node in the currently constructing graph. @internal */
export function memo<TFrom extends IFrom>(options: IMemoOptions<TFrom>): IBinding<number> {
  const owner = constructing;
  if (owner === undefined) { throw new Error('A memo belongs inside analysis construction'); }
  if (options === null || typeof options !== 'object') { throw new TypeError('Expected memo options'); }
  const name = dataField(options, 'name');
  const authoredSubject = Object.hasOwn(options, 'subject') ? dataField(options, 'subject') : name;
  const from = dataField(options, 'from');
  const authoredRun = dataField(options, 'run');
  if (typeof name !== 'string' || name.length === 0 || typeof authoredSubject !== 'string' || authoredSubject.length === 0) {
    throw new TypeError('Occurrence name and complete subject must be nonempty strings');
  }
  if (owner.nodes.some((node) => node.name === name)) { throw new Error(`Duplicate occurrence ${name}`); }
  if (owner.nodes.some((node) => node.subject === authoredSubject)) { throw new Error(`Duplicate complete subject ${authoredSubject}`); }
  if (owner.nodes.length >= 2) { throw new Error('The bounded prototype permits at most two numeric nodes'); }
  if (typeof authoredRun !== 'function') { throw new TypeError('Expected an authored run function'); }
  if (from === null || typeof from !== 'object' || Array.isArray(from)
    || (Object.getPrototypeOf(from) !== Object.prototype && Object.getPrototypeOf(from) !== null)
    || Object.getOwnPropertySymbols(from).length !== 0) { throw new TypeError('Expected a plain from record of owned origins'); }
  const edges: IEdge[] = [];
  for (const key of Object.getOwnPropertyNames(from)) {
    const token = dataField(from, key);
    const origin = token !== null && typeof token === 'object' ? owner.origins.get(token) : undefined;
    if (origin === undefined) { throw new TypeError(`from.${key} must be an origin owned by this analysis`); }
    edges.push(Object.freeze({ key, kind: origin.kind, slot: origin.slot }));
  }
  // Own data descriptors were validated before reading the typed callback. The
  // original function is retained unchanged so Tracking can fingerprint it.
  owner.nodes.push(Object.freeze({ name, subject: authoredSubject, edges: Object.freeze(edges), run: options.run }));
  return binding<number>(owner, { kind: 'memo', slot: name });
}

/** Only the execution adapter can inspect a graph this experiment minted. @internal */
export function graphOf(entry: IAnalysis<object>): IGraph {
  const graph = typeof entry === 'object' && entry !== null ? graphs.get(entry) : undefined;
  if (graph === undefined) { throw new TypeError('Expected an analysis owned by this experiment'); }
  return graph;
}
