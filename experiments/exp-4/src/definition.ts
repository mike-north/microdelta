/**
 * EXP-4 Definition & Binding candidate: one frozen composition with input and
 * collection slots, one supplied callable slot, one fanout template built once
 * and a strict fold. It owns structural descriptors and current correspondence;
 * it never selects history, decides freshness or runs a body.
 */
import type { IData, IPath } from './data.js';

/**
 * A structural address independent of labels, source text and call order.
 * Template steps carry their template and the collection binding that scopes
 * member keys (COL-1); an instance adds the member key.
 * @internal
 */
export interface IDescriptor {
  readonly scope: string;
  readonly role: 'input' | 'collection' | 'callable' | 'step';
  readonly slot: string;
  readonly template?: string;
  readonly collection?: string;
  readonly memberKey?: string;
}

/** Stable local encoding of a descriptor; persisted records keep the fields separately. @internal */
export function descriptorKey(descriptor: IDescriptor): string {
  return JSON.stringify([
    descriptor.scope, descriptor.role, descriptor.slot,
    descriptor.template ?? null, descriptor.collection ?? null, descriptor.memberKey ?? null,
  ]);
}

/** A tracked read view onto a child call's output; every read is a consumed-output fact of that call. @internal */
export interface IChildView {
  read(path: IPath): IData;
}

/**
 * The only way a body reaches data or declared children. `read` records a fact
 * at a binding path (`input`, `member`, `argument`); `peek` reads without
 * recording a fact and marks later derived arguments unjustified; `call`
 * invokes a declared callable slot by its structural slot name.
 * @internal
 */
export interface IContext {
  /** The member key of a fanout instance; structural, not an observation. */
  readonly key: string | undefined;
  read(path: IPath): IData;
  peek(path: IPath): IData;
  call(slot: string, ...args: readonly unknown[]): IChildView;
}

/** An explicit strict-fold entry; a skipped member is never `undefined` and never omitted. @internal */
export interface IMemberEntry {
  readonly key: string;
  readonly status: 'succeeded' | 'skipped';
}

/** A strict fold additionally observes the keyed outcome of every current member. @internal */
export interface IFoldContext extends IContext {
  members(): readonly IMemberEntry[];
}

/** A memoized body; `undefined` is a successful output distinct from a skip. @internal */
export type IMemoBody = (context: IContext) => IData | undefined;

/** A tracked gate selects whether a declared instance runs; it never edits topology. @internal */
export type IGateBody = (context: IContext) => boolean;

/** A strict fold body over explicit keyed member outcomes. @internal */
export type IFoldBody = (context: IFoldContext) => IData | undefined;

/** An author custom-key function over one discovered member record (COL-1). @internal */
export type IKeyFunction = (record: IData) => string;

/** A current step implementation that may be supplied to a callable slot; its label is display-only. @internal */
export interface IStepDeclaration {
  readonly body: IMemoBody;
  readonly label: string;
}

/** A forwarded-argument token naming its structural origin, resolved from current bindings. @internal */
export interface IForwarded {
  readonly origin: IPath;
}

/** Handles are minted by one builder; their descriptors are frozen copies. @internal */
export interface IInputHandle { readonly kind: 'input'; readonly descriptor: IDescriptor }
/** @internal */
export interface ICollectionHandle { readonly kind: 'collection'; readonly descriptor: IDescriptor }
/** @internal */
export interface ICallableHandle { readonly kind: 'callable'; readonly descriptor: IDescriptor }
/** @internal */
export interface ITemplateStepHandle { readonly kind: 'template-step'; readonly descriptor: IDescriptor }
/** @internal */
export interface IFoldHandle { readonly kind: 'fold'; readonly descriptor: IDescriptor }

/** The symbolic member builder passed once to a template factory. @internal */
export interface ITemplateBuilder {
  gate(body: IGateBody): void;
  memo(slot: string, body: IMemoBody, calls?: readonly ICallableHandle[]): ITemplateStepHandle;
}

/** Fanout options: the collection binding, optional custom key and the template factory. @internal */
export interface IFanoutOptions {
  readonly collection: ICollectionHandle;
  readonly key?: IKeyFunction;
  readonly template: (member: ITemplateBuilder) => readonly ITemplateStepHandle[];
}

/** A frozen fanout exposes its template step slots structurally. @internal */
export interface IFanoutHandle {
  readonly kind: 'fanout';
  step(slot: string): ITemplateStepHandle;
}

/** Composition-phase declarations; every method rejects after freeze (CMP-1/CMP-9). @internal */
export interface IBuilder {
  input(slot: string): IInputHandle;
  collection(slot: string): ICollectionHandle;
  callable(slot: string): ICallableHandle;
  supply(callable: ICallableHandle, implementation: IStepDeclaration): void;
  fanout(slot: string, options: IFanoutOptions): IFanoutHandle;
  fold(slot: string, over: ITemplateStepHandle, body: IFoldBody): IFoldHandle;
}

/** A frozen composition; its topology lists abstract nodes and edges only. @internal */
export interface IGraph {
  readonly scope: string;
  readonly topology: readonly string[];
}

/** A compiled template step: its template-level descriptor, body and declared callable slots by name. @internal */
export interface ICompiledStep {
  readonly descriptor: IDescriptor;
  readonly body: IMemoBody;
  readonly calls: ReadonlyMap<string, IDescriptor>;
}

/** The single frozen fanout: collection binding, key strategy, optional gate and owned step copies. @internal */
export interface ICompiledFanout {
  readonly slot: string;
  readonly collection: IDescriptor;
  readonly key: IKeyFunction | undefined;
  readonly gate: IGateBody | undefined;
  readonly steps: readonly ICompiledStep[];
}

/** A strict fold over one template step's keyed instances. @internal */
export interface ICompiledFold {
  readonly descriptor: IDescriptor;
  readonly over: IDescriptor;
  readonly body: IFoldBody;
}

/** What a structural descriptor names in the current composition. @internal */
export type IDeclaration =
  | { readonly kind: 'input' }
  | { readonly kind: 'collection' }
  | { readonly kind: 'implementation'; readonly step: IStepDeclaration }
  | { readonly kind: 'template-step'; readonly step: ICompiledStep }
  | { readonly kind: 'fold'; readonly fold: ICompiledFold };

/** Only a unique current declaration satisfies a historical descriptor (CMP-6). @internal */
export type IResolution =
  | { readonly status: 'found'; readonly declaration: IDeclaration }
  | { readonly status: 'missing' }
  | { readonly status: 'ambiguous' };

/** Frozen current correspondence: every declaration registered under its descriptor. @internal */
export interface ICompiledGraph {
  readonly scope: string;
  readonly fanout: ICompiledFanout | undefined;
  readonly folds: readonly ICompiledFold[];
  resolve(descriptor: IDescriptor): IResolution;
}

/** Framework-owned compiled state; the author-visible graph object carries no mutable structure. */
const compiled = new WeakMap<IGraph, ICompiledGraph>();

/** Tokens created by `forward`; any other object passed as an argument is ordinary data or unreconstructible. */
const forwardTokens = new WeakSet<object>();

/** Binding families a forwarded origin may name in its calling frame. */
const originFamilies = new Set(['input', 'member', 'child']);

/** Reject empty slot names so an absent name can never alias a real one. */
function slotName(slot: string, what: string): string {
  if (typeof slot !== 'string' || slot.length === 0) {
    throw new TypeError(`EXP-4 ${what} needs a nonempty slot name`);
  }
  return slot;
}

/** Declare a supplied step implementation; the label is display-only and never a locator. @internal */
export function step(body: IMemoBody, label = 'step'): IStepDeclaration {
  if (typeof body !== 'function') {
    throw new TypeError('EXP-4 step implementation must be a function');
  }
  return Object.freeze({ body, label });
}

/**
 * Create a forwarded-argument token naming a structural origin in the calling
 * frame: an input slot path, the member binding, or an earlier child's output.
 * @internal
 */
export function forward(origin: IPath): IForwarded {
  const [family] = origin;
  if (typeof family !== 'string' || !originFamilies.has(family)
    || !origin.every(segment => typeof segment === 'string' || Number.isSafeInteger(segment))) {
    throw new TypeError('EXP-4 forwarded origin must start with input, member or child');
  }
  const token: IForwarded = Object.freeze({ origin: Object.freeze([...origin]) });
  forwardTokens.add(token);
  return token;
}

/** Distinguish a genuine forward token from look-alike data. @internal */
export function isForwarded(value: unknown): value is IForwarded {
  return typeof value === 'object' && value !== null && forwardTokens.has(value);
}

/** Resolve a frozen graph's compiled state; forged graph objects are rejected. @internal */
export function compiledGraph(graph: IGraph): ICompiledGraph {
  const state = compiled.get(graph);
  if (state === undefined) {
    throw new TypeError('EXP-4 graph was not produced by compose');
  }
  return state;
}

/** Registry keys ignore member keys: every instance of a template step resolves to its template declaration. */
function registryKey(descriptor: IDescriptor): string {
  const { memberKey: _instance, ...template } = descriptor;
  return descriptorKey(template);
}

/**
 * Build and freeze one composition. The define callback runs once; every
 * builder (including the symbolic member builder) rejects use after freeze,
 * and the graph keeps its own copies of author arrays (CMP-1, CMP-9).
 * @internal
 */
export function compose(scope: string, define: (builder: IBuilder) => void): IGraph {
  slotName(scope, 'composition');
  const entries = new Map<string, IDeclaration[]>();
  const topology: string[] = [];
  const minted = new WeakSet<object>();
  const templateSteps = new Map<string, ICompiledStep>();
  const folds: ICompiledFold[] = [];
  let fanout: ICompiledFanout | undefined;
  let frozen = false;

  const open = (operation: string): void => {
    if (frozen) {
      throw new TypeError(`EXP-4 composition is frozen: ${operation} after freeze has no effect on topology`);
    }
  };
  const register = (descriptor: IDescriptor, declaration: IDeclaration): void => {
    const key = registryKey(descriptor);
    entries.set(key, [...(entries.get(key) ?? []), declaration]);
  };
  const mint = <T extends object>(handle: T): T => {
    minted.add(handle);
    return Object.freeze(handle);
  };
  const owned = (handle: object, kind: string): void => {
    if (!minted.has(handle)) {
      throw new TypeError(`EXP-4 ${kind} handle was not declared by this composition`);
    }
  };

  const builder: IBuilder = {
    input(slot) {
      open('input');
      const descriptor: IDescriptor = Object.freeze({ scope, role: 'input', slot: slotName(slot, 'input') });
      register(descriptor, { kind: 'input' });
      topology.push(`input ${slot}`);
      return mint({ kind: 'input', descriptor });
    },
    collection(slot) {
      open('collection');
      const descriptor: IDescriptor = Object.freeze({ scope, role: 'collection', slot: slotName(slot, 'collection') });
      register(descriptor, { kind: 'collection' });
      topology.push(`collection ${slot}`);
      return mint({ kind: 'collection', descriptor });
    },
    callable(slot) {
      open('callable');
      const descriptor: IDescriptor = Object.freeze({ scope, role: 'callable', slot: slotName(slot, 'callable') });
      topology.push(`callable ${slot}`);
      return mint({ kind: 'callable', descriptor });
    },
    supply(callable, implementation) {
      open('supply');
      owned(callable, 'callable');
      // A second supply is kept, not replaced: correspondence then reports ambiguity instead of a silent winner.
      register(callable.descriptor, { kind: 'implementation', step: step(implementation.body, implementation.label) });
    },
    fanout(slot, options) {
      open('fanout');
      if (fanout !== undefined) {
        throw new TypeError('EXP-4 bounds one composition to one fanout template');
      }
      owned(options.collection, 'collection');
      const template = slotName(slot, 'fanout');
      const collection = options.collection.descriptor;
      const declared = new Map<object, ICompiledStep>();
      let gate: IGateBody | undefined;
      let factoryOpen = true;
      const member: ITemplateBuilder = {
        gate(body) {
          open('gate');
          if (!factoryOpen || gate !== undefined || typeof body !== 'function') {
            throw new TypeError('EXP-4 template gate is declared once, as a function, inside the factory');
          }
          gate = body;
        },
        memo(stepSlot, body, calls = []) {
          open('memo');
          if (!factoryOpen) {
            throw new TypeError('EXP-4 composition is frozen: template steps are declared only inside the factory');
          }
          const descriptor: IDescriptor = Object.freeze({ scope, role: 'step', slot: slotName(stepSlot, 'template step'), template, collection: collection.slot });
          const callSlots = new Map<string, IDescriptor>();
          for (const callable of calls) {
            owned(callable, 'callable');
            callSlots.set(callable.descriptor.slot, callable.descriptor);
          }
          const handle = mint({ kind: 'template-step' as const, descriptor });
          declared.set(handle, Object.freeze({ descriptor, body, calls: callSlots }));
          return handle;
        },
      };
      // CMP-4: the topology factory runs exactly once; the returned author array is copied immediately.
      const returned = [...options.template(member)];
      factoryOpen = false;
      const steps: ICompiledStep[] = [];
      for (const handle of returned) {
        const compiledStep = declared.get(handle);
        if (compiledStep === undefined || templateSteps.has(compiledStep.descriptor.slot)) {
          throw new TypeError('EXP-4 template must return distinct steps declared by its own member builder');
        }
        templateSteps.set(compiledStep.descriptor.slot, compiledStep);
        steps.push(compiledStep);
        register(compiledStep.descriptor, { kind: 'template-step', step: compiledStep });
        topology.push(`step ${template}/${compiledStep.descriptor.slot}`);
        for (const callee of compiledStep.calls.keys()) {
          topology.push(`edge ${template}/${compiledStep.descriptor.slot} -> callable ${callee}`);
        }
      }
      topology.push(`template ${template} over collection ${collection.slot}`);
      if (gate !== undefined) {
        topology.push(`gate ${template}`);
      }
      fanout = Object.freeze({ slot: template, collection, key: options.key, gate, steps: Object.freeze(steps) });
      return Object.freeze({
        kind: 'fanout' as const,
        step(stepSlot: string): ITemplateStepHandle {
          const found = templateSteps.get(stepSlot);
          if (found === undefined) {
            throw new TypeError(`EXP-4 fanout ${template} has no template step ${stepSlot}`);
          }
          return mint({ kind: 'template-step', descriptor: found.descriptor });
        },
      });
    },
    fold(slot, over, body) {
      open('fold');
      owned(over, 'template step');
      const descriptor: IDescriptor = Object.freeze({ scope, role: 'step', slot: slotName(slot, 'fold') });
      const fold: ICompiledFold = Object.freeze({ descriptor, over: over.descriptor, body });
      folds.push(fold);
      register(descriptor, { kind: 'fold', fold });
      topology.push(`fold ${slot} over ${over.descriptor.template ?? ''}/${over.descriptor.slot}`);
      return mint({ kind: 'fold', descriptor });
    },
  };

  define(builder);
  frozen = true;
  const graph: IGraph = Object.freeze({ scope, topology: Object.freeze([...topology].sort()) });
  const frozenFolds = Object.freeze([...folds]);
  compiled.set(graph, {
    scope,
    fanout,
    folds: frozenFolds,
    resolve(descriptor: IDescriptor): IResolution {
      const found = entries.get(registryKey(descriptor)) ?? [];
      const [only] = found;
      if (only === undefined) {
        return { status: 'missing' };
      }
      return found.length === 1 ? { status: 'found', declaration: only } : { status: 'ambiguous' };
    },
  });
  return graph;
}
